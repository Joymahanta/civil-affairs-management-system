-- Civil Affairs Management System PostgreSQL schema
-- Safe to run repeatedly. Existing application data is not modified by this file.

CREATE TABLE IF NOT EXISTS departments (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS designations (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  department_id BIGINT REFERENCES departments(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS staff (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  designation_id BIGINT REFERENCES designations(id) ON DELETE SET NULL,
  department TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  attendance TEXT NOT NULL DEFAULT 'Present',
  current_task TEXT,
  last_sms_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS complaints (
  id BIGSERIAL PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  category TEXT NOT NULL,
  location TEXT NOT NULL,
  reporter_name TEXT NOT NULL,
  reporter_phone TEXT NOT NULL,
  reporter_email TEXT,
  description TEXT NOT NULL,
  photo_name TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  priority TEXT NOT NULL DEFAULT 'Medium',
  status TEXT NOT NULL DEFAULT 'New',
  assigned_to TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS complaint_history (
  id BIGSERIAL PRIMARY KEY,
  complaint_id BIGINT REFERENCES complaints(id) ON DELETE CASCADE,
  reference TEXT,
  action TEXT NOT NULL,
  status TEXT,
  assigned_to TEXT,
  message TEXT,
  changed_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS equipment (
  id BIGSERIAL PRIMARY KEY,
  asset_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  holder TEXT,
  issued_on DATE,
  expected_return DATE,
  condition TEXT NOT NULL DEFAULT 'Good',
  status TEXT NOT NULL DEFAULT 'Available'
);

CREATE TABLE IF NOT EXISTS tenders (
  id BIGSERIAL PRIMARY KEY,
  tender_no TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL,
  closing_date DATE,
  bids INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tender_bidders (
  id BIGSERIAL PRIMARY KEY,
  tender_id BIGINT REFERENCES tenders(id) ON DELETE CASCADE,
  bidder_name TEXT NOT NULL,
  bid_amount NUMERIC(14,2),
  status TEXT,
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tender_history (
  id BIGSERIAL PRIMARY KEY,
  tender_id BIGINT REFERENCES tenders(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  details TEXT,
  changed_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS activity (
  id BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS resident_users (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  password_hash TEXT,
  employee_id TEXT,
  staff_id BIGINT REFERENCES staff(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'Active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quarter_applications (
  id BIGSERIAL PRIMARY KEY,
  employee_id TEXT,
  applicant_name TEXT,
  phone TEXT,
  email TEXT,
  quarter_type TEXT,
  quarter_no TEXT,
  department TEXT,
  designation TEXT,
  status TEXT NOT NULL DEFAULT 'Submitted',
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shop_applications (
  id BIGSERIAL PRIMARY KEY,
  applicant_name TEXT,
  phone TEXT,
  email TEXT,
  shop_name TEXT,
  shop_type TEXT,
  location TEXT,
  status TEXT NOT NULL DEFAULT 'Submitted',
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS township_civilians (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS township_shops (
  id BIGSERIAL PRIMARY KEY,
  shop_code TEXT,
  name TEXT NOT NULL,
  owner_name TEXT,
  phone TEXT,
  location TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS qr_codes (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  location TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_history (
  id BIGSERIAL PRIMARY KEY,
  channel TEXT NOT NULL,
  recipient TEXT,
  message TEXT,
  status TEXT,
  provider_response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints(status);
CREATE INDEX IF NOT EXISTS idx_complaints_created_at ON complaints(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_complaints_assigned_to ON complaints(assigned_to);
CREATE INDEX IF NOT EXISTS idx_staff_phone ON staff(phone);
CREATE INDEX IF NOT EXISTS idx_staff_email ON staff(email);
CREATE INDEX IF NOT EXISTS idx_activity_created_at ON activity(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_resident_users_phone ON resident_users(phone);
CREATE INDEX IF NOT EXISTS idx_resident_users_email ON resident_users(email);
CREATE INDEX IF NOT EXISTS idx_quarter_applications_employee_id ON quarter_applications(employee_id);
CREATE INDEX IF NOT EXISTS idx_qr_codes_type ON qr_codes(type);
