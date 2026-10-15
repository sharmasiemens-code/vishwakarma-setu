-- Isolated integration-test fixture, NOT a supported production bootstrap.
-- Models the legacy base tables absent from this repository so real PostgreSQL
-- queries, incremental migrations and concurrency constraints can be exercised.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE TABLE users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), full_name varchar(150) NOT NULL,
 phone varchar(30) UNIQUE, email varchar(254) UNIQUE, password_hash text,
 role text NOT NULL CHECK(role IN ('CUSTOMER','TECHNICIAN','ADMIN')),
 is_active boolean NOT NULL DEFAULT true, is_verified boolean NOT NULL DEFAULT false,
 created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE TABLE customers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL UNIQUE REFERENCES users(id));
CREATE TABLE technicians (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL UNIQUE REFERENCES users(id),
 business_name text, bio text, experience_years numeric DEFAULT 0, service_radius_km numeric DEFAULT 10,
 kyc_status text DEFAULT 'SUBMITTED', availability_status text DEFAULT 'OFFLINE',
 rating_average numeric, total_jobs integer NOT NULL DEFAULT 0, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE TABLE technician_kyc (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), technician_id uuid UNIQUE NOT NULL REFERENCES technicians(id),
 verification_status text DEFAULT 'SUBMITTED', address_verified boolean DEFAULT false,
 created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE TABLE service_categories(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, is_active boolean DEFAULT true, sort_order integer DEFAULT 0);
CREATE TABLE services(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), category_id uuid REFERENCES service_categories(id), name text, description text, is_active boolean DEFAULT true);
CREATE TABLE skills(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, is_active boolean DEFAULT true);
CREATE TABLE tools(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, is_active boolean DEFAULT true);
CREATE TABLE service_skills(service_id uuid REFERENCES services(id), skill_id uuid REFERENCES skills(id), is_required boolean DEFAULT true, PRIMARY KEY(service_id,skill_id));
CREATE TABLE service_tools(service_id uuid REFERENCES services(id), tool_id uuid REFERENCES tools(id), is_required boolean DEFAULT true, PRIMARY KEY(service_id,tool_id));
CREATE TABLE technician_skills(technician_id uuid REFERENCES technicians(id), skill_id uuid REFERENCES skills(id), PRIMARY KEY(technician_id,skill_id));
CREATE TABLE technician_tools(technician_id uuid REFERENCES technicians(id), tool_id uuid REFERENCES tools(id), PRIMARY KEY(technician_id,tool_id));
CREATE TABLE technician_locations (
 technician_id uuid PRIMARY KEY REFERENCES technicians(id), location geography(Point,4326),
 accuracy_meters double precision, battery_percent integer, last_seen_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE TABLE service_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid REFERENCES customers(id), service_id uuid REFERENCES services(id),
 title text, description text, address_line1 text, address_line2 text, city text, state text, pincode text,
 location geography(Point,4326), search_radius_meters integer DEFAULT 10000, status text DEFAULT 'OPEN',
 preferred_date date, preferred_time_start time, preferred_time_end time,
 created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE TABLE service_request_photos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), service_request_id uuid REFERENCES service_requests(id), file_url text NOT NULL, created_at timestamptz DEFAULT now());
CREATE TABLE jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), service_request_id uuid REFERENCES service_requests(id),
 technician_id uuid REFERENCES technicians(id), customer_id uuid REFERENCES customers(id), status text DEFAULT 'ASSIGNED',
 estimated_amount numeric(12,2), final_amount numeric(12,2), assigned_at timestamptz DEFAULT now(),
 accepted_at timestamptz, started_at timestamptz, completed_at timestamptz, cancelled_at timestamptz,
 cancellation_reason text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE TABLE job_status_history(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid REFERENCES jobs(id), old_status text, new_status text, changed_by uuid REFERENCES users(id), remarks text, created_at timestamptz DEFAULT now());
CREATE TABLE ratings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid REFERENCES jobs(id), customer_id uuid REFERENCES customers(id), technician_id uuid REFERENCES technicians(id), rating integer CHECK(rating BETWEEN 1 AND 5), review text, created_at timestamptz DEFAULT now());
CREATE TABLE notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES users(id), title text, message text, notification_type text, reference_id uuid, is_read boolean NOT NULL DEFAULT false, created_at timestamptz DEFAULT now());
-- This record exists only in the disposable test database to satisfy the legacy
-- migration's audited administrator precondition. It has no login credential.
INSERT INTO users(id,full_name,role,is_active,is_verified) VALUES ('97db8fe2-4424-4cfc-af70-2cf4342369a1','Integration fixture administrator','ADMIN',true,true);
