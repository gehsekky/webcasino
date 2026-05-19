CREATE DATABASE db_webcasino ENCODING = "UTF8";
ALTER DATABASE db_webcasino OWNER TO postgres;

\connect db_webcasino

CREATE EXTENSION "uuid-ossp";

CREATE TABLE public.user (
  id UUID NOT NULL DEFAULT uuid_generate_v4(),
  name varchar(256) NOT NULL,
  email varchar(256) UNIQUE,
  salt varchar(32),
  password_hash varchar(512),
  money integer NOT NULL DEFAULT 0,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE public.oauth_identity (
  id UUID NOT NULL DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.user(id) ON DELETE CASCADE,
  provider varchar(32) NOT NULL,
  provider_user_id varchar(256) NOT NULL,
  email varchar(256),
  linked_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (provider, provider_user_id)
);

CREATE INDEX idx_oauth_identity_user_id ON public.oauth_identity(user_id);

CREATE TABLE public.casino_table (
  id UUID NOT NULL DEFAULT uuid_generate_v4(),
  game_type varchar(32) NOT NULL,
  minimum_bet integer NOT NULL,
  maximum_bet integer NOT NULL,
  max_seats integer NOT NULL DEFAULT 1,
  created_by UUID NOT NULL REFERENCES public.user(id),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE public.seat (
  id UUID NOT NULL DEFAULT uuid_generate_v4(),
  table_id UUID NOT NULL REFERENCES public.casino_table(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.user(id),
  position integer NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (table_id, position)
);

CREATE INDEX idx_seat_user_id ON public.seat(user_id);

CREATE TABLE public.hand (
  id UUID NOT NULL DEFAULT uuid_generate_v4(),
  table_id UUID NOT NULL REFERENCES public.casino_table(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES public.user(id),
  data json NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE INDEX idx_hand_table_id ON public.hand(table_id);

CREATE TABLE public.hand_seat (
  id UUID NOT NULL DEFAULT uuid_generate_v4(),
  hand_id UUID NOT NULL REFERENCES public.hand(id) ON DELETE CASCADE,
  seat_id UUID NOT NULL REFERENCES public.seat(id),
  user_id UUID NOT NULL REFERENCES public.user(id),
  data json NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (hand_id, seat_id)
);

CREATE INDEX idx_hand_seat_user_id ON public.hand_seat(user_id);

CREATE TABLE public.hand_seat_bet (
  id UUID NOT NULL DEFAULT uuid_generate_v4(),
  hand_seat_id UUID NOT NULL REFERENCES public.hand_seat(id) ON DELETE CASCADE,
  amount integer NOT NULL,
  type varchar(128) NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE INDEX idx_hand_seat_bet_hand_seat_id ON public.hand_seat_bet(hand_seat_id);

CREATE TABLE public.hand_seat_round (
  hand_seat_id UUID NOT NULL REFERENCES public.hand_seat(id) ON DELETE CASCADE,
  round integer NOT NULL,
  action varchar(64) NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (hand_seat_id, round)
);

CREATE INDEX idx_hand_seat_round_hand_seat_id ON public.hand_seat_round(hand_seat_id);

CREATE TABLE public.money_transaction (
  id UUID NOT NULL DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.user(id),
  hand_seat_id UUID REFERENCES public.hand_seat(id),
  type varchar(32) NOT NULL,
  amount integer NOT NULL,
  note varchar(512),
  idempotency_key varchar(128) UNIQUE,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
