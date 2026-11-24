-- Retail products the shop sells over the counter. Display only: they are not bookable and never
-- part of an appointment (services are). Seeded with the three products both clients used to
-- hard-code, so the landing pages show the same list after the upgrade.
CREATE TABLE retail_products (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    size_label VARCHAR(30),
    price DECIMAL(10, 2) NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT uq_retail_products_name UNIQUE (name)
);

INSERT INTO retail_products (name, size_label, price, sort_order) VALUES
('Styling Fiber Clay', '100ml', 24.00, 1),
('Sandalwood Beard Balm', '60ml', 19.00, 2),
('Straight Razor Shave Cream', '150ml', 22.00, 3);
