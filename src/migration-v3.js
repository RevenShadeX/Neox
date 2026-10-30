"use strict";
function migrationV3(db) {
  if (db.pragma("user_version", { simple: true }) >= 3) return;
  db.transaction(() => {
    db.exec(`
 CREATE TABLE system_accounts(name TEXT PRIMARY KEY,balance INTEGER NOT NULL CHECK(typeof(balance)='integer' AND balance BETWEEN 0 AND 8000000000000000));
 INSERT INTO system_accounts(name,balance) VALUES('gambling',0);
 CREATE TABLE economy_events(id INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL CHECK(kind IN ('mint','consume')),amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount>0),source TEXT NOT NULL,at INTEGER NOT NULL);
 CREATE INDEX economy_events_age ON economy_events(at);
 CREATE TABLE wager_history(id INTEGER PRIMARY KEY AUTOINCREMENT,user TEXT NOT NULL REFERENCES players(id),game TEXT NOT NULL,wager INTEGER NOT NULL,payout INTEGER NOT NULL,at INTEGER NOT NULL);
 CREATE INDEX wager_history_age ON wager_history(at);
 CREATE TABLE ui_sessions(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES players(id),guild TEXT NOT NULL,kind TEXT NOT NULL,state TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'active',expires INTEGER NOT NULL,created INTEGER NOT NULL);
 CREATE INDEX ui_owner ON ui_sessions(owner,kind,status,expires);
 CREATE INDEX ui_age ON ui_sessions(expires);
 CREATE TABLE role_shop_settings(guild TEXT PRIMARY KEY,enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN(0,1)));
 CREATE TABLE role_listings(guild TEXT NOT NULL,role TEXT NOT NULL,name TEXT NOT NULL,price INTEGER NOT NULL CHECK(typeof(price)='integer' AND price BETWEEN 1 AND 1000000000000),version INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(guild,role));
 CREATE TABLE role_purchases(id TEXT PRIMARY KEY,request TEXT NOT NULL UNIQUE,guild TEXT NOT NULL,buyer TEXT NOT NULL REFERENCES players(id),role TEXT NOT NULL,price INTEGER NOT NULL CHECK(typeof(price)='integer' AND price BETWEEN 1 AND 1000000000000),status TEXT NOT NULL CHECK(status IN('pending','assigning','uncertain','delivered','refunded')),attempts INTEGER NOT NULL DEFAULT 0,lease TEXT,lease_until INTEGER NOT NULL DEFAULT 0,next_attempt INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL,updated INTEGER NOT NULL,error TEXT);
 CREATE UNIQUE INDEX role_purchase_active ON role_purchases(guild,buyer,role) WHERE status IN('pending','assigning','uncertain');
 CREATE INDEX role_purchase_recovery ON role_purchases(status,next_attempt,lease_until);
 CREATE INDEX role_purchase_buyer ON role_purchases(buyer,status,created);
 CREATE TABLE refund_credits(user TEXT PRIMARY KEY REFERENCES players(id),amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount BETWEEN 0 AND 1000000000000));
 CREATE TABLE duel_matches(id TEXT PRIMARY KEY,guild TEXT NOT NULL,challenger TEXT NOT NULL REFERENCES players(id),opponent TEXT NOT NULL REFERENCES players(id),wager INTEGER NOT NULL CHECK(typeof(wager)='integer' AND wager BETWEEN 1 AND 1000000000000),status TEXT NOT NULL DEFAULT 'pending',random INTEGER NOT NULL DEFAULT 0,accepted_a INTEGER NOT NULL DEFAULT 1,accepted_b INTEGER NOT NULL DEFAULT 0,expires INTEGER NOT NULL,created INTEGER NOT NULL,roll_a INTEGER,roll_b INTEGER,winner TEXT);
 CREATE INDEX duel_expiry ON duel_matches(status,expires);
 CREATE TABLE matchmaking(user TEXT PRIMARY KEY REFERENCES players(id),guild TEXT NOT NULL,wager INTEGER NOT NULL,token TEXT NOT NULL,expires INTEGER NOT NULL,created INTEGER NOT NULL);
 CREATE INDEX matchmaking_compatible ON matchmaking(guild,wager,created);
 CREATE TABLE duel_presence(user TEXT PRIMARY KEY REFERENCES players(id),guild TEXT NOT NULL,kind TEXT NOT NULL,reference TEXT NOT NULL,expires INTEGER NOT NULL);
 DELETE FROM dice_duels;
 PRAGMA user_version=3;
 `);
  }).immediate();
}
module.exports = { migrationV3 };
