# Business Requirements Document (BRD)
## Human Resource Management System (HRMS)

| | |
|---|---|
| **Version** | 0.1 (Draft) |
| **Date** | 2026-10-24 |
| **Status** | For team review |
| **Owner** | TBD |

---

## 1. Purpose
Build a web-based HRMS that lets the business manage its employees and organization structure in one secure place, replacing spreadsheets and manual processes.

## 2. Business Objectives
1. Keep a single, accurate source of truth for employee data.
2. Control who can see and change HR data (role-based access).
3. Give HR, managers and employees a clear view of the workforce through dashboards.
4. Keep an auditable history of changes to sensitive data.
5. Provide a foundation that can later add leave, attendance, payroll, recruitment and performance modules.

## 3. Scope

### 3.1 In scope (MVP)
- Authentication & Authorization
- Dashboard
- Employee Management
- Organization Management
- User/role administration and audit log

### 3.2 Out of scope (later phases)
Leave management, attendance/timesheets, payroll, recruitment, performance reviews, mobile app, multi-tenant support.

## 4. Stakeholders and Users

| Role | Description |
|---|---|
| Super Admin | Sets up the system, company structure and HR Admins. Full access. |
| HR Admin | Manages employees, org data and non-admin user accounts. |
| Manager | Views and reviews their team's information. |
| Employee | Views and updates limited details of their own profile. |

## 5. Business Requirements

Priority: **M** = Must have, **S** = Should have, **C** = Could have.

### 5.1 Authentication & Authorization

| ID | Requirement | Priority |
|---|---|---|
| AUTH-01 | Users log in with email and password. | M |
| AUTH-02 | New users must set a new password on first login. | M |
| AUTH-03 | Users can reset a forgotten password through a single-use, time-limited email link. | M |
| AUTH-04 | Accounts lock for 15 minutes after 5 failed login attempts. | M |
| AUTH-05 | Access is controlled by role (Super Admin, HR Admin, Manager, Employee). | M |
| AUTH-06 | Data access is scoped: employees see own data, managers see their team, HR sees all. | M |
| AUTH-07 | Sessions expire after inactivity, and logout ends the session on the server. | M |
| AUTH-08 | Deactivated or terminated employees cannot log in. | M |
| AUTH-09 | Multi-factor authentication and SSO. | C |

### 5.2 Dashboard

| ID | Requirement | Priority |
|---|---|---|
| DASH-01 | Each role sees a dashboard tailored to it after login. | M |
| DASH-02 | Employee dashboard shows job info, announcements, upcoming holidays and quick links. | M |
| DASH-03 | Manager dashboard adds team headcount, team list, birthdays/anniversaries and new joiners. | S |
| DASH-04 | HR dashboard shows KPIs: total headcount, active, on probation, new hires, exits. | M |
| DASH-05 | HR dashboard shows charts: headcount by department/location, hires vs. exits over 12 months. | S |
| DASH-06 | HR dashboard shows pending actions (incomplete profiles, probation ending, missing or expiring documents). | S |
| DASH-07 | KPI and chart items link to the filtered employee list. | C |
| DASH-08 | Super Admin dashboard adds user counts by role, recent audit events and setup checklist. | S |

### 5.3 Organization Management

| ID | Requirement | Priority |
|---|---|---|
| ORG-01 | Manage locations (create, edit, deactivate). | M |
| ORG-02 | Manage departments with optional parent department and department head. | M |
| ORG-03 | Manage designations/job titles with grade or level. | M |
| ORG-04 | Names and codes must be unique; circular department hierarchies are blocked. | M |
| ORG-05 | A department with active employees cannot be deleted, only deactivated or reassigned. | M |
| ORG-06 | HR can bulk reassign employees from one department to another. | S |
| ORG-07 | Company settings: holidays, work week, probation length. | S |
| ORG-08 | An org chart is built from reporting lines, with expand/collapse and search. | S |
| ORG-09 | Reporting loops are detected and rejected on save. | M |

### 5.4 Employee Management

| ID | Requirement | Priority |
|---|---|---|
| EMP-01 | HR can create an employee with personal, job and account details; employee ID is auto-generated. | M |
| EMP-02 | The system rejects duplicate emails and employee IDs. | M |
| EMP-03 | Creating an employee creates a login and sends a welcome email. | M |
| EMP-04 | Users can search, filter (department, location, status, type, manager), sort and paginate the employee list, within their data scope. | M |
| EMP-05 | Employee profile shows Overview, Job, Personal, Documents and History tabs. | M |
| EMP-06 | Sensitive fields (national ID, salary, bank details) are visible only to permitted roles. | M |
| EMP-07 | Employees can edit their own contact details, address, emergency contact and photo. | M |
| EMP-08 | HR can edit all employee fields. | M |
| EMP-09 | Every change is recorded with who, when, field, old value and new value. | M |
| EMP-10 | HR can record job changes (promotion, transfer, manager change) with an effective date; history is preserved. | M |
| EMP-11 | Upload and download employee documents (PDF, JPG, PNG) with category, type/size limits and permission checks. | M |
| EMP-12 | Documents can have an expiry date that appears in HR pending actions. | C |
| EMP-13 | HR can bulk import employees from CSV with row-level validation and a preview before confirming. | S |
| EMP-14 | HR can export the employee list (HR only, audited). | S |
| EMP-15 | Offboarding: last working day, reason, exit checklist; on the last day login is disabled and the record becomes read-only. | M |
| EMP-16 | Offboarding is blocked until the employee's direct reports are reassigned. | M |
| EMP-17 | Employee records are never hard-deleted (soft delete only). | M |

### 5.5 User Administration and Audit

| ID | Requirement | Priority |
|---|---|---|
| ADM-01 | Admins can change roles, deactivate, unlock and resend invites for users. | M |
| ADM-02 | The last Super Admin cannot be demoted or deactivated. | M |
| ADM-03 | An audit log records logins, failed logins, role changes, employee create/edit/export and document downloads. | M |
| ADM-04 | Audit log is read-only and filterable by user, action, entity and date. | M |

## 6. Access Matrix

| Resource | Employee | Manager | HR Admin | Super Admin |
|---|---|---|---|---|
| Own profile | View, limited edit | View, limited edit | Full | Full |
| Team profiles | No | View | Full | Full |
| All employees | No | No | Full | Full |
| Org structure | View | View | Manage | Manage |
| Users and roles | No | No | Limited (non-admin roles) | Full |
| Audit log | No | No | View | View |

## 7. Key Business Flows
1. **System setup:** Super Admin logs in, changes password, then creates locations, departments, designations, company settings and the first HR Admin.
2. **Onboarding:** HR adds employee, system creates the account and sends an invite, employee sets password and confirms profile.
3. **Daily use:** users log in, land on their dashboard, search or view employees within their scope.
4. **Job change:** HR records the change with an effective date; history is kept and affected reports are notified.
5. **Offboarding:** HR starts offboarding, completes the checklist, and on the last day access is disabled and the record becomes read-only.

## 8. Non-Functional Requirements

| Area | Requirement |
|---|---|
| Security | Passwords hashed; HTTPS only; sensitive fields encrypted at rest; server-side authorization on every request; protection against common web attacks (injection, XSS, CSRF). |
| Privacy | Access to personal data limited to what the role needs; every sensitive access is scoped. |
| Auditability | Changes to employee, role and org data are logged and cannot be altered. |
| Performance | Pages load in under 3 seconds for lists up to the expected employee count. |
| Availability | Business-hours availability with daily backups. |
| Usability | Inline validation, confirmation for destructive actions, empty/loading/error states on every screen. |
| Responsiveness | Employee self-service pages work on mobile browsers. |
| Compatibility | Latest versions of Chrome, Edge, Firefox and Safari. |

## 9. Assumptions
- Single company (no multi-tenancy) in the MVP.
- Email delivery is available for invites and password resets.
- Employee data volume is small to medium (to be confirmed).
- Users access the system through a web browser.

## 10. Constraints and Dependencies
- Email service for notifications.
- Secure file storage for documents.
- Compliance with applicable data protection laws for the operating country (to be confirmed).

## 11. Open Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Do employee self-edits need HR approval or apply immediately? | TBD |
| 2 | Can a user hold multiple roles or exactly one? | TBD |
| 3 | Can managers see team salary or only basic info? | TBD |
| 4 | Rehire: reactivate the old record or create a linked new one? | TBD |
| 5 | Are MFA/SSO in the MVP? | TBD |
| 6 | Retention period for terminated records and documents? | TBD |
| 7 | Expected number of employees and single vs. multi-company? | TBD |
| 8 | Technology stack (React + Express + Postgres, or Angular + FastAPI + MySQL)? | TBD |

## 12. Success Criteria
- HR can set up the organization and onboard an employee end to end without spreadsheets.
- Every role sees only the data it is permitted to see (verified by access tests).
- All employee, role and export actions appear in the audit log.
- Offboarded employees cannot log in after their last working day.

## 13. Phasing

| Phase | Content |
|---|---|
| MVP | Auth and roles, organization setup, employee CRUD, dashboards, user admin, audit log |
| Phase 2 | Leave, attendance, notifications, expanded documents |
| Phase 3 | Payroll, recruitment, performance |

## 14. Approval

| Name | Role | Signature | Date |
|---|---|---|---|
| | Business Owner | | |
| | HR Lead | | |
| | Technical Lead | | |
