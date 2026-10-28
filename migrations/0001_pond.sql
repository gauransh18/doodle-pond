-- Doodle Pond on Cloudflare D1. One shared pond: anyone can draw a fish, and keeping a
-- fish takes it out of the pond for everyone until its keeper releases it.
-- Clients never touch this database; functions/api/[[route]].js does, and enforces the limits.

create table if not exists fish (
  id text primary key,
  name text not null,
  artist text not null,
  strokes text not null,             -- JSON stroke list, validated by the API
  catches integer not null default 0,
  reports integer not null default 0,
  hidden integer not null default 0, -- 1 after 3 reports, until you review it
  hidden_at text,
  created_at text not null,          -- ISO time
  creator_ip text,                   -- salted hash, for the per-IP insert limit
  kept_at text,
  keeper_hash text,                  -- SHA-256 of the keeper's secret owner key
  keeper_ip text                     -- salted hash, for the per-IP keep limit
);

create index if not exists fish_created_idx on fish (created_at);
create index if not exists fish_keeper_idx on fish (keeper_hash) where keeper_hash is not null;
create index if not exists fish_kept_idx on fish (kept_at) where kept_at is not null;
create index if not exists fish_kept_ip_idx on fish (keeper_ip, kept_at) where keeper_ip is not null;
create index if not exists fish_creator_ip_idx on fish (creator_ip, created_at) where creator_ip is not null;
create index if not exists fish_hidden_idx on fish (hidden_at) where hidden = 1;

-- one report per IP per fish
create table if not exists reports (
  fish_id text not null,
  ip text not null,
  created_at text not null,
  primary key (fish_id, ip)
);

-- running totals, so stats never count the whole table
create table if not exists counters (
  id integer primary key check (id = 1),
  fish_count integer not null default 0, -- visible fish ever drawn
  pond_count integer not null default 0, -- visible and not kept
  catch_count integer not null default 0
);
insert or ignore into counters (id) values (1);

-- random salt for IP hashes, made once
create table if not exists secrets (
  id integer primary key check (id = 1),
  salt text not null
);
insert or ignore into secrets (id, salt) values (1, lower(hex(randomblob(16))));

create trigger if not exists fish_counted_insert after insert on fish
begin
  update counters set
    fish_count = fish_count + (new.hidden = 0),
    pond_count = pond_count + (new.hidden = 0 and new.kept_at is null)
  where id = 1;
end;

create trigger if not exists fish_counted_update after update of hidden, kept_at on fish
begin
  update counters set
    fish_count = fish_count + (new.hidden = 0) - (old.hidden = 0),
    pond_count = pond_count + (new.hidden = 0 and new.kept_at is null) - (old.hidden = 0 and old.kept_at is null)
  where id = 1;
end;

create trigger if not exists fish_counted_catch after update of catches on fish
begin
  update counters set catch_count = catch_count + (new.catches - old.catches) where id = 1;
end;
