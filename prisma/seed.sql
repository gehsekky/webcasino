CREATE DATABASE db_webcasino ENCODING = "UTF8";
ALTER DATABASE db_webcasino OWNER TO postgres;

\connect db_webcasino

CREATE EXTENSION "uuid-ossp";

CREATE TABLE public.user (
  id UUID NOT NULL DEFAULT uuid_generate_v4(),
  name varchar(256) NOT NULL UNIQUE,
  salt varchar(32),
  password_hash varchar(512),
  money integer NOT NULL DEFAULT 0,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE public.game (
  id UUID NOT NULL DEFAULT uuid_generate_v4(),
  created_by UUID NOT NULL REFERENCES public.user(id),
  data json NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE public.game_player (
  id UUID NOT NULL DEFAULT uuid_generate_v4(),
  game_id UUID NOT NULL REFERENCES public.game(id),
  user_id UUID NOT NULL REFERENCES public.user(id),
  data json NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE public.game_player_bet (
  id UUID NOT NULL DEFAULT uuid_generate_v4(),
  game_player_id UUID NOT NULL REFERENCES public.game_player(id),
  amount integer NOT NULL,
  type varchar(128) NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE public.game_player_round (
  game_player_id UUID NOT NULL REFERENCES public.game_player(id),
  round integer NOT NULL,
  action varchar(64) NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (game_player_id, round)
);

CREATE INDEX idx_game_player_round_game_player_id ON public.game_player_round(game_player_id);

CREATE TABLE public.money_transaction (
  id UUID NOT NULL DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.user(id),
  game_player_id UUID REFERENCES public.game_player(id),
  type varchar(32) NOT NULL,
  note varchar(512),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

insert into public.user (id, name, money) values ('e8ec2a06-00eb-453e-8170-00e4da633483', 'andy', 10000);
insert into public.game (id, created_by, data) values ('16646f6c-daa2-4f16-8f9a-7a41e02b2293', 'e8ec2a06-00eb-453e-8170-00e4da633483', '{"type":"blackjack","minimumBet":5,"maximumBet":100,"deck":[{"suit":"spades","rank":"Queen"},{"suit":"spades","rank":"8"},{"suit":"clubs","rank":"Queen"},{"suit":"diamonds","rank":"5"},{"suit":"hearts","rank":"5"},{"suit":"clubs","rank":"King"},{"suit":"clubs","rank":"6"},{"suit":"diamonds","rank":"Queen"},{"suit":"spades","rank":"4"},{"suit":"spades","rank":"3"},{"suit":"diamonds","rank":"Jack"},{"suit":"hearts","rank":"Queen"},{"suit":"diamonds","rank":"Ace"},{"suit":"hearts","rank":"9"},{"suit":"spades","rank":"5"},{"suit":"diamonds","rank":"9"},{"suit":"diamonds","rank":"3"},{"suit":"hearts","rank":"6"},{"suit":"spades","rank":"2"},{"suit":"clubs","rank":"5"},{"suit":"hearts","rank":"Jack"},{"suit":"clubs","rank":"Ace"},{"suit":"hearts","rank":"4"},{"suit":"clubs","rank":"7"},{"suit":"hearts","rank":"2"},{"suit":"diamonds","rank":"8"},{"suit":"hearts","rank":"3"},{"suit":"spades","rank":"7"},{"suit":"diamonds","rank":"4"},{"suit":"clubs","rank":"4"},{"suit":"hearts","rank":"8"},{"suit":"hearts","rank":"King"},{"suit":"clubs","rank":"8"},{"suit":"spades","rank":"Jack"},{"suit":"clubs","rank":"3"},{"suit":"hearts","rank":"7"},{"suit":"spades","rank":"6"},{"suit":"clubs","rank":"Jack"},{"suit":"clubs","rank":"9"},{"suit":"diamonds","rank":"2"},{"suit":"spades","rank":"9"},{"suit":"spades","rank":"Ace"},{"suit":"clubs","rank":"2"},{"suit":"diamonds","rank":"King"},{"suit":"hearts","rank":"Ace"},{"suit":"diamonds","rank":"7"},{"suit":"diamonds","rank":"6"},{"suit":"spades","rank":"King"}]}');
insert into public.game_player (id, user_id, game_id, data) values ('de86d81d-05c7-4bb0-b159-ca1db0912278', 'e8ec2a06-00eb-453e-8170-00e4da633483', '16646f6c-daa2-4f16-8f9a-7a41e02b2293', '{"cards": []}');
