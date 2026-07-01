CREATE TABLE barbers (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    email VARCHAR(100),
    phone VARCHAR(50)
);

CREATE TABLE barber_schedules (
    id BIGSERIAL PRIMARY KEY,
    barber_id BIGINT NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
    day_of_week INTEGER NOT NULL, -- 1 (Monday) to 7 (Sunday)
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    UNIQUE (barber_id, day_of_week)
);

CREATE TABLE barber_time_off (
    id BIGSERIAL PRIMARY KEY,
    barber_id BIGINT NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    reason VARCHAR(255)
);

-- Seed data for existing barbers
INSERT INTO barbers (name) VALUES 
('Alex the Barber'),
('Sara the Stylist'),
('Marcus Master Blade');

-- Seed schedules: Monday-Saturday 09:00 to 17:00 (1 to 6)
INSERT INTO barber_schedules (barber_id, day_of_week, start_time, end_time)
SELECT id, 1, '09:00:00', '17:00:00' FROM barbers;
INSERT INTO barber_schedules (barber_id, day_of_week, start_time, end_time)
SELECT id, 2, '09:00:00', '17:00:00' FROM barbers;
INSERT INTO barber_schedules (barber_id, day_of_week, start_time, end_time)
SELECT id, 3, '09:00:00', '17:00:00' FROM barbers;
INSERT INTO barber_schedules (barber_id, day_of_week, start_time, end_time)
SELECT id, 4, '09:00:00', '17:00:00' FROM barbers;
INSERT INTO barber_schedules (barber_id, day_of_week, start_time, end_time)
SELECT id, 5, '09:00:00', '17:00:00' FROM barbers;
INSERT INTO barber_schedules (barber_id, day_of_week, start_time, end_time)
SELECT id, 6, '09:00:00', '17:00:00' FROM barbers;

-- Seed some time off for testing
INSERT INTO barber_time_off (barber_id, start_date, end_date, reason)
SELECT id, '2030-12-25', '2030-12-31', 'Vacation'
FROM barbers WHERE name = 'Alex the Barber';
