PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  business_type TEXT,
  pipeline_stage TEXT CHECK(pipeline_stage IN ('Active','Discovery','Intro','Prospect','Graveyard','Lead','Deal','Closed','Archived')) DEFAULT 'Prospect',
  last_communication_at TEXT,
  next_step TEXT,
  recent_meeting_summary TEXT,
  brief_meeting_note TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name);

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  role TEXT,
  email TEXT,
  phone TEXT,
  notes TEXT,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS communications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  contact_id INTEGER,
  method TEXT CHECK(method IN ('whatsapp','gmail','zoom','in_person','other')) NOT NULL,
  timestamp TEXT NOT NULL,
  direction TEXT CHECK(direction IN ('inbound','outbound')) DEFAULT 'outbound',
  summary TEXT,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_comms_timestamp ON communications(timestamp);

