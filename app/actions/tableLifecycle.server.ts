import { randomBytes } from 'node:crypto';
import { prisma } from 'db.server';
import { getAvailableAIUsers } from 'auth/aiUsers.server';
import { startBlackjackHand, type BlackjackRoomConfig } from './handEngine.server';
import { startPokerHand, type PokerRoomConfig } from './pokerEngine.server';
import { startHoldemHand, type HoldemRoomConfig } from './holdemEngine.server';
import { startSlotsHand, type SlotsRoomConfig } from './slotsEngine.server';
import { startRouletteHand, type RouletteRoomConfig } from './rouletteEngine.server';

/**
 * Room (a.k.a. casino_table) lifecycle: create, accept invites, list,
 * start a hand. The hand-engine wrappers in `handEngine.server.ts` /
 * `pokerEngine.server.ts` no longer create rooms themselves; they
 * consume an existing room + a resolved participant roster from here.
 *
 * Vocabulary note: the DB calls it `casino_table` and the UI calls it
 * a "game" or "room"; in code we use "room" as the consistent noun.
 */

export type RoomGameType = 'blackjack' | 'poker' | 'holdem' | 'slots' | 'roulette';

export const ROOM_NAME_MAX_LENGTH = 128;

/** Per-game seat-count constraints. `min` is what the engine requires to
 *  actually start a hand. `max` is the UI cap; the DB doesn't enforce one. */
export const GAME_SEAT_RANGES: Record<RoomGameType, { min: number; max: number }> = {
  blackjack: { min: 1, max: 7 },
  poker: { min: 2, max: 9 },
  holdem: { min: 2, max: 9 },
  slots: { min: 1, max: 1 },
  roulette: { min: 1, max: 8 },
};

/**
 * Minimal user shape — just the id. Lets callers pass either the
 * session-user shape or a fully-hydrated Prisma user without ceremony.
 */
export type ActingUser = { id: string };

export type CreateRoomParams = {
  creator: ActingUser;
  name: string;
  gameType: RoomGameType;
  minimumBet: number;
  maximumBet: number;
  /** Total seats (humans + AI fills). Must satisfy GAME_SEAT_RANGES for the game. */
  numSeats: number;
};

export type CreateRoomResult = {
  roomId: string;
  joinToken: string;
  creatorSeatId: string;
};

/**
 * Provision a new room. The creator is seated at position 1 immediately;
 * the join token is generated and saved so the shareable URL is stable.
 * No hand is started — that's an explicit `startHand` from the room view.
 */
export async function createRoom(params: CreateRoomParams): Promise<CreateRoomResult> {
  if (!(params.gameType in GAME_SEAT_RANGES)) {
    throw new Error(`createRoom: unsupported game type '${params.gameType}'`);
  }
  const trimmedName = params.name.trim();
  if (trimmedName.length === 0) {
    throw new Response('room name is required', { status: 400 });
  }
  if (trimmedName.length > ROOM_NAME_MAX_LENGTH) {
    throw new Response(`room name exceeds ${ROOM_NAME_MAX_LENGTH} characters`, { status: 400 });
  }
  const range = GAME_SEAT_RANGES[params.gameType];
  if (params.numSeats < range.min || params.numSeats > range.max) {
    throw new Response(
      `numSeats must be between ${range.min} and ${range.max} for ${params.gameType}`,
      { status: 400 },
    );
  }
  if (params.minimumBet < 1 || params.maximumBet < params.minimumBet) {
    throw new Response('invalid bet bounds', { status: 400 });
  }

  // Per-creator uniqueness on name. The DB unique index is the hard
  // enforcer; this check lets us return a friendly 409 instead of a
  // Prisma constraint error.
  const dupe = await prisma.casino_table.findFirst({
    where: { created_by: params.creator.id, name: trimmedName },
    select: { id: true },
  });
  if (dupe) {
    throw new Response('you already have a room with that name', { status: 409 });
  }

  const joinToken = generateJoinToken();

  return prisma.$transaction(async (tx) => {
    const room = await tx.casino_table.create({
      data: {
        name: trimmedName,
        game_type: params.gameType,
        minimum_bet: params.minimumBet,
        maximum_bet: params.maximumBet,
        max_seats: params.numSeats,
        join_token: joinToken,
        created_by: params.creator.id,
      },
    });

    const seat = await tx.seat.create({
      data: {
        table_id: room.id,
        user_id: params.creator.id,
        position: 1,
      },
    });

    return {
      roomId: room.id,
      joinToken,
      creatorSeatId: seat.id,
    };
  });
}

/**
 * Change the game type at a room. Allowed only for the creator, only when
 * no hand is in progress, and only when the room's seat count is
 * compatible with the new game's constraints. The new game's first hand
 * starts on the next `startHand` call.
 */
export async function switchRoomGame(params: {
  roomId: string;
  newGameType: RoomGameType;
  by: ActingUser;
}): Promise<{ changed: boolean }> {
  if (!(params.newGameType in GAME_SEAT_RANGES)) {
    throw new Response(`unsupported game type '${params.newGameType}'`, { status: 400 });
  }

  const room = await prisma.casino_table.findUnique({
    where: { id: params.roomId },
    include: { hand: { orderBy: { created_at: 'desc' }, take: 1 } },
  });
  if (!room) {
    throw new Response('room not found', { status: 404 });
  }
  if (room.created_by !== params.by.id) {
    throw new Response('only the room creator can switch games', { status: 403 });
  }
  if (room.game_type === params.newGameType) {
    return { changed: false };
  }

  const latest = room.hand[0];
  const latestPhase = (latest?.data as { phase?: string } | undefined)?.phase;
  if (latest && latestPhase !== 'settled') {
    throw new Response('cannot switch games while a hand is in progress', { status: 409 });
  }

  const range = GAME_SEAT_RANGES[params.newGameType];
  if (room.max_seats < range.min || room.max_seats > range.max) {
    throw new Response(
      `room has ${room.max_seats} seats; ${params.newGameType} requires ${range.min}–${range.max}`,
      { status: 409 },
    );
  }

  await prisma.casino_table.update({
    where: { id: params.roomId },
    data: { game_type: params.newGameType },
  });
  return { changed: true };
}

/**
 * Token format: URL-safe, short enough to type, long enough to be
 * unguessable. 9 random bytes → 12 base64url characters.
 */
function generateJoinToken(): string {
  return randomBytes(9).toString('base64url');
}

export type JoinViaTokenResult =
  | { kind: 'already_seated'; roomId: string }
  | { kind: 'already_invited'; roomId: string; invitationId: string; status: string }
  | { kind: 'invited'; roomId: string; invitationId: string };

/**
 * Resolve a /join/:token visit. If the user is already a seated member,
 * just point them at the room. Otherwise upsert a pending invitation so
 * the user sees it on their landing page and can accept.
 */
export async function joinViaToken(params: {
  visitor: ActingUser;
  token: string;
}): Promise<JoinViaTokenResult> {
  const room = await prisma.casino_table.findUnique({
    where: { join_token: params.token },
    select: { id: true },
  });
  if (!room) {
    throw new Response('join token not found', { status: 404 });
  }

  // Already seated? Just send them through.
  const existingSeat = await prisma.seat.findFirst({
    where: { table_id: room.id, user_id: params.visitor.id },
    select: { id: true },
  });
  if (existingSeat) {
    return { kind: 'already_seated', roomId: room.id };
  }

  // Existing invitation? Don't overwrite an already-accepted/declined
  // decision — the user can re-decide from the landing page.
  const existingInvite = await prisma.table_invitation.findUnique({
    where: { table_id_user_id: { table_id: room.id, user_id: params.visitor.id } },
    select: { id: true, status: true },
  });
  if (existingInvite) {
    return {
      kind: 'already_invited',
      roomId: room.id,
      invitationId: existingInvite.id,
      status: existingInvite.status,
    };
  }

  const created = await prisma.table_invitation.create({
    data: {
      table_id: room.id,
      user_id: params.visitor.id,
      status: 'pending',
    },
    select: { id: true },
  });
  return { kind: 'invited', roomId: room.id, invitationId: created.id };
}

/**
 * Accept a pending invitation: flip the invitation status and claim the
 * next available seat position at the room. If all positions are taken
 * the accept fails.
 */
export async function acceptInvitation(params: {
  user: ActingUser;
  invitationId: string;
}): Promise<{ roomId: string; seatId: string }> {
  return prisma.$transaction(async (tx) => {
    const invite = await tx.table_invitation.findUnique({
      where: { id: params.invitationId },
      include: {
        casino_table: { select: { id: true, max_seats: true } },
      },
    });
    if (!invite || invite.user_id !== params.user.id) {
      throw new Response('invitation not found', { status: 404 });
    }
    if (invite.status === 'accepted') {
      // Idempotent: already accepted means they already have a seat.
      const seat = await tx.seat.findFirst({
        where: { table_id: invite.table_id, user_id: params.user.id },
        select: { id: true },
      });
      if (!seat) {
        throw new Error('acceptInvitation: invariant violated — accepted with no seat');
      }
      return { roomId: invite.table_id, seatId: seat.id };
    }

    // Find next open position.
    const taken = await tx.seat.findMany({
      where: { table_id: invite.table_id },
      select: { position: true },
    });
    const positionsTaken = new Set(taken.map((s) => s.position));
    let position = -1;
    for (let p = 1; p <= invite.casino_table.max_seats; p++) {
      if (!positionsTaken.has(p)) {
        position = p;
        break;
      }
    }
    if (position === -1) {
      throw new Response('room is full', { status: 409 });
    }

    const seat = await tx.seat.create({
      data: {
        table_id: invite.table_id,
        user_id: params.user.id,
        position,
      },
      select: { id: true },
    });
    await tx.table_invitation.update({
      where: { id: invite.id },
      data: { status: 'accepted', decided_at: new Date() },
    });

    return { roomId: invite.table_id, seatId: seat.id };
  });
}

export async function declineInvitation(params: {
  user: ActingUser;
  invitationId: string;
}): Promise<void> {
  const invite = await prisma.table_invitation.findUnique({
    where: { id: params.invitationId },
    select: { id: true, user_id: true, status: true },
  });
  if (!invite || invite.user_id !== params.user.id) {
    throw new Response('invitation not found', { status: 404 });
  }
  if (invite.status === 'declined') return;
  await prisma.table_invitation.update({
    where: { id: invite.id },
    data: { status: 'declined', decided_at: new Date() },
  });
}

export type UserRoomSummary = {
  id: string;
  name: string;
  gameType: string;
  minimumBet: number;
  maximumBet: number;
  maxSeats: number;
  seatedCount: number;
  isCreator: boolean;
  hasActiveHand: boolean;
  createdAt: Date;
};

/**
 * Rooms where the given user has a confirmed seat. Includes a rough
 * "is there a hand in progress?" flag so the landing page can show
 * a status badge.
 */
export async function listUserRooms(userId: string): Promise<UserRoomSummary[]> {
  const seats = await prisma.seat.findMany({
    where: { user_id: userId },
    include: {
      casino_table: {
        include: {
          seat: { select: { id: true } },
          hand: {
            orderBy: { created_at: 'desc' },
            take: 1,
            select: { data: true },
          },
        },
      },
    },
    orderBy: { created_at: 'desc' },
  });

  return seats.map((s) => {
    const t = s.casino_table;
    const latestHand = t.hand[0]?.data as { phase?: string } | undefined;
    const hasActiveHand = latestHand != null && latestHand.phase !== 'settled';
    return {
      id: t.id,
      name: t.name,
      gameType: t.game_type,
      minimumBet: t.minimum_bet,
      maximumBet: t.maximum_bet,
      maxSeats: t.max_seats,
      seatedCount: t.seat.length,
      isCreator: t.created_by === userId,
      hasActiveHand,
      createdAt: t.created_at,
    };
  });
}

export type UserInvitationSummary = {
  id: string;
  roomId: string;
  roomName: string;
  gameType: string;
  minimumBet: number;
  maximumBet: number;
  maxSeats: number;
  createdAt: Date;
};

/** Pending invitations for the given user (excludes accepted/declined). */
export async function listUserInvitations(userId: string): Promise<UserInvitationSummary[]> {
  const invites = await prisma.table_invitation.findMany({
    where: { user_id: userId, status: 'pending' },
    include: {
      casino_table: {
        select: {
          id: true,
          name: true,
          game_type: true,
          minimum_bet: true,
          maximum_bet: true,
          max_seats: true,
        },
      },
    },
    orderBy: { created_at: 'desc' },
  });
  return invites.map((i) => ({
    id: i.id,
    roomId: i.casino_table.id,
    roomName: i.casino_table.name,
    gameType: i.casino_table.game_type,
    minimumBet: i.casino_table.minimum_bet,
    maximumBet: i.casino_table.maximum_bet,
    maxSeats: i.casino_table.max_seats,
    createdAt: i.created_at,
  }));
}

/**
 * Start a new hand at a room. Looks at the room's seated humans, fills
 * empty positions with fresh AI users, and dispatches to the engine
 * wrapper for the room's game type. Refuses to start if the previous
 * hand at this room hasn't settled yet.
 */
export async function startHand(params: {
  roomId: string;
  startedBy: ActingUser;
}): Promise<{ handId: string }> {
  const room = await prisma.casino_table.findUnique({
    where: { id: params.roomId },
    include: {
      seat: {
        orderBy: { position: 'asc' },
        select: { id: true, user_id: true, position: true },
      },
      hand: {
        orderBy: { created_at: 'desc' },
        take: 1,
        select: { id: true, data: true },
      },
    },
  });
  if (!room) {
    throw new Response('room not found', { status: 404 });
  }

  // Only the creator can start a hand for now. Relaxed later if needed.
  if (room.created_by !== params.startedBy.id) {
    throw new Response('only the room creator can start a hand', { status: 403 });
  }

  // Refuse if a hand is already in progress at this room.
  const latest = room.hand[0]?.data as { phase?: string } | undefined;
  if (latest != null && latest.phase !== 'settled') {
    throw new Response('a hand is already in progress at this room', { status: 409 });
  }

  // Resolve participants: humans from persistent seats + AI fills for
  // empty positions. Sort by position so the engine's player order
  // matches the table layout.
  const positionsTaken = new Set(room.seat.map((s) => s.position));
  const openPositions: number[] = [];
  for (let p = 1; p <= room.max_seats; p++) {
    if (!positionsTaken.has(p)) openPositions.push(p);
  }
  const aiUsers = openPositions.length > 0 ? await getAvailableAIUsers(openPositions.length) : [];
  if (aiUsers.length < openPositions.length) {
    throw new Error('startHand: not enough AI users in the pool');
  }

  type Participant = {
    userId: string;
    seatId: string | null;
    position: number;
  };
  const participants: Participant[] = [
    ...room.seat.map((s) => ({
      userId: s.user_id,
      seatId: s.id,
      position: s.position,
    })),
    ...openPositions.map((position, i) => ({
      userId: aiUsers[i].id,
      seatId: null,
      position,
    })),
  ].sort((a, b) => a.position - b.position);

  if (room.game_type === 'blackjack') {
    const config: BlackjackRoomConfig = {
      minimumBet: room.minimum_bet,
      maximumBet: room.maximum_bet,
      // Reasonable defaults — wire to a per-room rule config later if we
      // want it in the create modal.
      numDecks: 6,
      dealerHitsSoft17: true,
    };
    return startBlackjackHand({
      roomId: room.id,
      participants,
      config,
      creatorId: params.startedBy.id,
    });
  }

  if (room.game_type === 'poker') {
    const config: PokerRoomConfig = {
      minBet: room.minimum_bet,
      maxBet: room.maximum_bet,
      ante: 1,
      minimumBuyIn: room.minimum_bet * 20,
      maximumBuyIn: room.maximum_bet * 10,
    };
    return startPokerHand({
      roomId: room.id,
      participants,
      config,
      creatorId: params.startedBy.id,
    });
  }

  if (room.game_type === 'holdem') {
    // Small blind = floor(min/2), big blind = minimum_bet. Buy-in cap is
    // generous (10× max bet) so chip stacks don't run out fast.
    const config: HoldemRoomConfig = {
      smallBlind: Math.max(1, Math.floor(room.minimum_bet / 2)),
      bigBlind: room.minimum_bet,
      minimumBuyIn: room.minimum_bet * 20,
      maximumBuyIn: room.maximum_bet * 10,
    };
    return startHoldemHand({
      roomId: room.id,
      participants,
      config,
      creatorId: params.startedBy.id,
    });
  }

  if (room.game_type === 'slots') {
    const config: SlotsRoomConfig = {
      minimumBet: room.minimum_bet,
      maximumBet: room.maximum_bet,
    };
    return startSlotsHand({
      roomId: room.id,
      participants,
      config,
      creatorId: params.startedBy.id,
    });
  }

  if (room.game_type === 'roulette') {
    const config: RouletteRoomConfig = {
      minimumBet: room.minimum_bet,
      maximumBet: room.maximum_bet,
    };
    return startRouletteHand({
      roomId: room.id,
      participants,
      config,
      creatorId: params.startedBy.id,
    });
  }

  throw new Error(`startHand: unsupported game type '${room.game_type}'`);
}
