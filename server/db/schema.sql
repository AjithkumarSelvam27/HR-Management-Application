CREATE TABLE IF NOT EXISTS locations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL UNIQUE,
  address VARCHAR(255),
  country VARCHAR(80),
  timezone VARCHAR(60),
  active TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS departments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL UNIQUE,
  code VARCHAR(20) NOT NULL UNIQUE,
  parent_id INT NULL,
  head_employee_id INT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  FOREIGN KEY (parent_id) REFERENCES departments(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS designations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(120) NOT NULL UNIQUE,
  grade VARCHAR(20),
  department_id INT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  FOREIGN KEY (department_id) REFERENCES departments(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(36) PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  role ENUM('super_admin','hr_admin','manager','employee') NOT NULL DEFAULT 'employee',
  active TINYINT(1) NOT NULL DEFAULT 1,
  must_change_password TINYINT(1) NOT NULL DEFAULT 1,
  failed_attempts INT NOT NULL DEFAULT 0,
  locked_until DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sessions (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS password_resets (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  expires_at DATETIME NOT NULL,
  used TINYINT(1) NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS employees (
  id INT AUTO_INCREMENT PRIMARY KEY,
  emp_code VARCHAR(20) NOT NULL UNIQUE,
  user_id VARCHAR(36) NULL UNIQUE,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  phone VARCHAR(40),
  dob DATE NULL,
  gender VARCHAR(20),
  address VARCHAR(255),
  emergency_contact_name VARCHAR(120),
  emergency_contact_phone VARCHAR(40),
  national_id VARCHAR(60),
  salary DECIMAL(12,2) NULL,
  department_id INT NULL,
  designation_id INT NULL,
  location_id INT NULL,
  manager_id INT NULL,
  employment_type ENUM('full_time','part_time','contract','intern') NOT NULL DEFAULT 'full_time',
  status ENUM('onboarding','active','probation','offboarding','terminated') NOT NULL DEFAULT 'onboarding',
  join_date DATE NOT NULL,
  probation_end_date DATE NULL,
  last_working_day DATE NULL,
  exit_reason VARCHAR(255),
  exit_checklist JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (department_id) REFERENCES departments(id),
  FOREIGN KEY (designation_id) REFERENCES designations(id),
  FOREIGN KEY (location_id) REFERENCES locations(id),
  FOREIGN KEY (manager_id) REFERENCES employees(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS employee_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  employee_id INT NOT NULL,
  changed_by VARCHAR(36) NULL,
  change_type VARCHAR(40) NOT NULL,
  field VARCHAR(60),
  old_value VARCHAR(255),
  new_value VARCHAR(255),
  effective_date DATE NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_hist_emp (employee_id),
  FOREIGN KEY (employee_id) REFERENCES employees(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS pending_job_changes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  employee_id INT NOT NULL,
  change_type VARCHAR(40) NOT NULL,
  changes JSON NOT NULL,
  effective_date DATE NOT NULL,
  created_by VARCHAR(36) NULL,
  applied TINYINT(1) NOT NULL DEFAULT 0,
  FOREIGN KEY (employee_id) REFERENCES employees(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS documents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  employee_id INT NOT NULL,
  category VARCHAR(40) NOT NULL,
  filename VARCHAR(255) NOT NULL,
  stored_name VARCHAR(80) NOT NULL,
  mime VARCHAR(80) NOT NULL,
  size INT NOT NULL,
  expiry_date DATE NULL,
  uploaded_by VARCHAR(36) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS holidays (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  holiday_date DATE NOT NULL UNIQUE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS settings (
  k VARCHAR(60) PRIMARY KEY,
  v VARCHAR(255) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(36) NULL,
  user_email VARCHAR(255),
  action VARCHAR(60) NOT NULL,
  entity VARCHAR(60),
  entity_id VARCHAR(60),
  detail VARCHAR(500),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_action (action),
  INDEX idx_audit_created (created_at)
) ENGINE=InnoDB;
