-- =====================================================================
-- PLATEFORME TONTINE - Schéma PostgreSQL 14+
-- Montants en XAF (entiers, sans décimale)
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------- TYPES ----------
CREATE TYPE platform_role   AS ENUM ('user','super_admin');
CREATE TYPE user_status     AS ENUM ('pending','active','suspended','closed');
CREATE TYPE kyc_status      AS ENUM ('none','submitted','verified','rejected');
CREATE TYPE group_role      AS ENUM ('president','treasurer','member','observer');
CREATE TYPE member_status   AS ENUM ('invited','pending','active','suspended','left');
CREATE TYPE group_status    AS ENUM ('draft','recruiting','active','completed','cancelled');
CREATE TYPE frequency_type  AS ENUM ('weekly','biweekly','monthly');
CREATE TYPE payout_rule     AS ENUM ('strict','flexible');
CREATE TYPE order_mode      AS ENUM ('random','manual');
CREATE TYPE fee_type        AS ENUM ('fixed','percent');
CREATE TYPE cycle_status    AS ENUM ('planned','running','completed');
CREATE TYPE round_status    AS ENUM ('scheduled','open','collecting','ready','paid_out','failed','cancelled');
CREATE TYPE contrib_status  AS ENUM ('pending','paid','late','failed','refunded','waived');
CREATE TYPE payment_status  AS ENUM ('initiated','pending','confirmed','failed','refunded');
CREATE TYPE payout_status   AS ENUM ('pending_approval','approved','processing','success','failed','cancelled');
CREATE TYPE account_type    AS ENUM ('mtn_momo','orange_money','bank');
CREATE TYPE ledger_type     AS ENUM ('contribution','penalty','payout','platform_fee','provider_fee','refund','guarantee_in','guarantee_out','adjustment');
CREATE TYPE channel_type    AS ENUM ('sms','email','push','whatsapp','in_app');
CREATE TYPE notif_status    AS ENUM ('queued','sent','failed','read');
CREATE TYPE dispute_status  AS ENUM ('open','in_review','resolved','rejected');
CREATE TYPE invite_status   AS ENUM ('pending','accepted','expired','revoked');

-- ---------- UTILISATEURS ----------
CREATE TABLE users (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name        VARCHAR(150) NOT NULL,
  phone            VARCHAR(20)  NOT NULL UNIQUE,         -- format E.164 (+237...)
  email            VARCHAR(190) UNIQUE,
  password_hash    TEXT,                                  -- NULL tant que non activé
  platform_role    platform_role NOT NULL DEFAULT 'user',
  status           user_status   NOT NULL DEFAULT 'pending',
  phone_verified_at TIMESTAMPTZ,
  email_verified_at TIMESTAMPTZ,
  kyc              kyc_status NOT NULL DEFAULT 'none',
  id_document_url  TEXT,
  two_fa_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
  two_fa_secret    TEXT,
  failed_logins    INT NOT NULL DEFAULT 0,
  locked_until     TIMESTAMPTZ,
  created_by       UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payout_accounts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          account_type NOT NULL,
  account_number VARCHAR(40) NOT NULL,
  holder_name   VARCHAR(150) NOT NULL,
  is_default    BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at   TIMESTAMPTZ,
  active_from   TIMESTAMPTZ NOT NULL DEFAULT now() + interval '24 hours', -- délai anti-fraude
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, type, account_number)
);

CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  user_agent  TEXT,
  ip          INET,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE otp_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  target      VARCHAR(190) NOT NULL,          -- téléphone ou email
  purpose     VARCHAR(40)  NOT NULL,          -- register, login, payout_account, payout_approval, reset
  code_hash   TEXT NOT NULL,
  attempts    INT NOT NULL DEFAULT 0,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- GROUPES ----------
CREATE TABLE groups (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                VARCHAR(150) NOT NULL,
  description         TEXT,
  rules_text          TEXT,                                   -- règlement intérieur
  contribution_amount BIGINT NOT NULL CHECK (contribution_amount > 0),
  currency            CHAR(3) NOT NULL DEFAULT 'XAF',
  frequency           frequency_type NOT NULL,
  payment_deadline_days INT NOT NULL DEFAULT 2,               -- jours de grâce après ouverture du tour
  start_date          DATE NOT NULL,
  min_members         INT NOT NULL DEFAULT 10 CHECK (min_members >= 2),
  max_members         INT NOT NULL DEFAULT 100 CHECK (max_members <= 100),
  payout_rule         payout_rule NOT NULL DEFAULT 'flexible',
  beneficiary_pays    BOOLEAN NOT NULL DEFAULT TRUE,          -- le bénéficiaire cotise-t-il à son tour ?
  late_fee_type       fee_type NOT NULL DEFAULT 'fixed',
  late_fee_value      BIGINT NOT NULL DEFAULT 0,
  platform_fee_type   fee_type NOT NULL DEFAULT 'percent',
  platform_fee_value  BIGINT NOT NULL DEFAULT 0,              -- pour percent : en centièmes de % (150 = 1,50 %)
  order_mode          order_mode NOT NULL DEFAULT 'random',
  dual_approval_threshold BIGINT,                             -- montant au-delà duquel 2 validations
  invite_code         VARCHAR(12) NOT NULL UNIQUE,
  status              group_status NOT NULL DEFAULT 'draft',
  launched_at         TIMESTAMPTZ,
  created_by          UUID NOT NULL REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (max_members >= min_members)
);

CREATE TABLE group_members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id),
  role        group_role NOT NULL DEFAULT 'member',
  status      member_status NOT NULL DEFAULT 'pending',
  position    INT,                                   -- rang de passage dans le cycle
  shares      INT NOT NULL DEFAULT 1 CHECK (shares >= 1), -- nombre de "mains" (option)
  risk_flag   BOOLEAN NOT NULL DEFAULT FALSE,
  rules_accepted_at TIMESTAMPTZ,
  invited_by  UUID REFERENCES users(id),
  approved_by UUID REFERENCES users(id),
  joined_at   TIMESTAMPTZ,
  left_at     TIMESTAMPTZ,
  UNIQUE (group_id, user_id),
  UNIQUE (group_id, position)
);
CREATE INDEX idx_gm_user ON group_members(user_id);

CREATE TABLE invitations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  phone       VARCHAR(20),
  email       VARCHAR(190),
  token_hash  TEXT NOT NULL,
  role        group_role NOT NULL DEFAULT 'member',
  status      invite_status NOT NULL DEFAULT 'pending',
  expires_at  TIMESTAMPTZ NOT NULL,
  created_by  UUID NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (phone IS NOT NULL OR email IS NOT NULL)
);

-- ---------- CYCLES ET TOURS ----------
CREATE TABLE cycles (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id     UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  cycle_number INT NOT NULL,
  start_date   DATE NOT NULL,
  end_date     DATE,
  status       cycle_status NOT NULL DEFAULT 'planned',
  draw_seed    TEXT,                -- graine du tirage au sort (preuve d'équité)
  drawn_at     TIMESTAMPTZ,
  UNIQUE (group_id, cycle_number)
);

CREATE TABLE rounds (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id              UUID NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
  group_id              UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  round_number          INT NOT NULL,
  beneficiary_member_id UUID NOT NULL REFERENCES group_members(id),
  opens_on              DATE NOT NULL,
  due_date              DATE NOT NULL,               -- date limite de paiement
  payout_date           DATE NOT NULL,               -- date prévue de décaissement
  expected_amount       BIGINT NOT NULL,
  collected_amount      BIGINT NOT NULL DEFAULT 0,
  status                round_status NOT NULL DEFAULT 'scheduled',
  closed_at             TIMESTAMPTZ,
  UNIQUE (cycle_id, round_number),
  UNIQUE (cycle_id, beneficiary_member_id)
);
CREATE INDEX idx_rounds_status_date ON rounds(status, payout_date);

CREATE TABLE contributions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id      UUID NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  member_id     UUID NOT NULL REFERENCES group_members(id),
  amount        BIGINT NOT NULL CHECK (amount > 0),
  penalty_amount BIGINT NOT NULL DEFAULT 0,
  status        contrib_status NOT NULL DEFAULT 'pending',
  due_date      DATE NOT NULL,
  paid_at       TIMESTAMPTZ,
  UNIQUE (round_id, member_id)
);
CREATE INDEX idx_contrib_status ON contributions(status, due_date);

-- ---------- PAIEMENTS ----------
CREATE TABLE payments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contribution_id    UUID NOT NULL REFERENCES contributions(id),
  user_id            UUID NOT NULL REFERENCES users(id),
  provider           VARCHAR(40) NOT NULL,
  provider_reference VARCHAR(120) UNIQUE,
  method             account_type,
  payer_number       VARCHAR(40),
  amount             BIGINT NOT NULL CHECK (amount > 0),
  provider_fee       BIGINT NOT NULL DEFAULT 0,
  status             payment_status NOT NULL DEFAULT 'initiated',
  idempotency_key    VARCHAR(80) NOT NULL UNIQUE,
  failure_reason     TEXT,
  raw_webhook        JSONB,
  receipt_number     VARCHAR(30) UNIQUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at       TIMESTAMPTZ
);
CREATE INDEX idx_payments_contrib ON payments(contribution_id);

CREATE TABLE webhook_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider      VARCHAR(40) NOT NULL,
  event_id      VARCHAR(120) NOT NULL,
  payload       JSONB NOT NULL,
  signature_ok  BOOLEAN NOT NULL,
  processed_at  TIMESTAMPTZ,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, event_id)                          -- anti-rejeu
);

-- ---------- SÉQUESTRE & LEDGER ----------
CREATE TABLE escrow_accounts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id       UUID NOT NULL UNIQUE REFERENCES groups(id),
  currency       CHAR(3) NOT NULL DEFAULT 'XAF',
  balance_cached BIGINT NOT NULL DEFAULT 0 CHECK (balance_cached >= 0),
  guarantee_balance BIGINT NOT NULL DEFAULT 0 CHECK (guarantee_balance >= 0),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Grand livre immuable : une seule ligne = un mouvement (débit OU crédit)
CREATE TABLE ledger_entries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escrow_account_id UUID NOT NULL REFERENCES escrow_accounts(id),
  round_id          UUID REFERENCES rounds(id),
  type              ledger_type NOT NULL,
  debit             BIGINT NOT NULL DEFAULT 0 CHECK (debit  >= 0),
  credit            BIGINT NOT NULL DEFAULT 0 CHECK (credit >= 0),
  reference_table   VARCHAR(40),
  reference_id      UUID,
  description       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((debit = 0) <> (credit = 0))
);
CREATE INDEX idx_ledger_escrow ON ledger_entries(escrow_account_id, created_at);

-- Interdit UPDATE / DELETE sur le ledger
CREATE OR REPLACE FUNCTION forbid_ledger_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is append-only';
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ledger_no_update BEFORE UPDATE OR DELETE ON ledger_entries
FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();

-- ---------- DÉCAISSEMENTS ----------
CREATE TABLE payouts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id              UUID NOT NULL REFERENCES rounds(id),
  beneficiary_member_id UUID NOT NULL REFERENCES group_members(id),
  destination_account_id UUID NOT NULL REFERENCES payout_accounts(id),
  gross_amount          BIGINT NOT NULL,
  platform_fee          BIGINT NOT NULL DEFAULT 0,
  provider_fee          BIGINT NOT NULL DEFAULT 0,
  net_amount            BIGINT NOT NULL,
  status                payout_status NOT NULL DEFAULT 'pending_approval',
  requested_by          UUID REFERENCES users(id),
  approved_by           UUID REFERENCES users(id),
  second_approved_by    UUID REFERENCES users(id),
  provider_reference    VARCHAR(120) UNIQUE,
  idempotency_key       VARCHAR(80) NOT NULL UNIQUE,
  attempts              INT NOT NULL DEFAULT 0,
  failure_reason        TEXT,
  executed_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Un seul décaissement réussi ou en cours par tour
CREATE UNIQUE INDEX uq_payout_one_active_per_round
  ON payouts(round_id) WHERE status IN ('pending_approval','approved','processing','success');

-- ---------- DETTES / GARANTIE ----------
CREATE TABLE member_debts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id   UUID NOT NULL REFERENCES group_members(id),
  round_id    UUID REFERENCES rounds(id),
  amount      BIGINT NOT NULL CHECK (amount > 0),
  settled     BIGINT NOT NULL DEFAULT 0,
  status      VARCHAR(20) NOT NULL DEFAULT 'open',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- NOTIFICATIONS / LITIGES / AUDIT ----------
CREATE TABLE notifications (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel   channel_type NOT NULL,
  template  VARCHAR(60) NOT NULL,
  payload   JSONB NOT NULL DEFAULT '{}',
  status    notif_status NOT NULL DEFAULT 'queued',
  sent_at   TIMESTAMPTZ,
  read_at   TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notif_user ON notifications(user_id, created_at DESC);

CREATE TABLE disputes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    UUID NOT NULL REFERENCES groups(id),
  round_id    UUID REFERENCES rounds(id),
  payment_id  UUID REFERENCES payments(id),
  opened_by   UUID NOT NULL REFERENCES users(id),
  subject     VARCHAR(190) NOT NULL,
  description TEXT NOT NULL,
  status      dispute_status NOT NULL DEFAULT 'open',
  resolution  TEXT,
  resolved_by UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE audit_logs (
  id         BIGSERIAL PRIMARY KEY,
  actor_id   UUID REFERENCES users(id),
  action     VARCHAR(80) NOT NULL,
  entity     VARCHAR(60) NOT NULL,
  entity_id  UUID,
  metadata   JSONB NOT NULL DEFAULT '{}',
  ip         INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_entity ON audit_logs(entity, entity_id);

CREATE TABLE reconciliations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_date        DATE NOT NULL UNIQUE,
  ledger_total    BIGINT NOT NULL,
  provider_total  BIGINT NOT NULL,
  difference      BIGINT NOT NULL,
  status          VARCHAR(20) NOT NULL,      -- ok / mismatch
  details         JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE platform_settings (
  key        VARCHAR(80) PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO platform_settings(key,value) VALUES
 ('group_limits','{"min":10,"max":100}'),
 ('contribution_limits','{"min":1000,"max":5000000}'),
 ('kyc_required_for_payout', 'true');

-- ---------- Vue utile : solde réel du séquestre depuis le ledger ----------
CREATE VIEW v_escrow_balance AS
SELECT escrow_account_id, SUM(credit) - SUM(debit) AS balance
FROM ledger_entries GROUP BY escrow_account_id;
