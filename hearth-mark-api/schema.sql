-- Hearth & Mark — MariaDB schema
-- Run: mysql -u root -p < schema.sql

CREATE DATABASE IF NOT EXISTS hearth_mark CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE hearth_mark;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(128),
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('customer','admin') NOT NULL DEFAULT 'customer',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS products (
  id VARCHAR(32) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  category ENUM('candles','clocks','frames') NOT NULL,
  description TEXT,
  price DECIMAL(10,2) NOT NULL,
  discount INT NOT NULL DEFAULT 0,
  stock INT NOT NULL DEFAULT 0,
  personalise BOOLEAN NOT NULL DEFAULT FALSE,
  lines INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS orders (
  id VARCHAR(32) PRIMARY KEY,
  order_no VARCHAR(32) NOT NULL UNIQUE,
  username VARCHAR(64),
  customer_name VARCHAR(128),
  total DECIMAL(10,2) NOT NULL,
  status ENUM('Placed','Processing','Shipped','Delivered') NOT NULL DEFAULT 'Placed',
  address1 VARCHAR(255),
  address2 VARCHAR(255),
  city VARCHAR(128),
  postcode VARCHAR(32),
  country VARCHAR(128),
  phone VARCHAR(64),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id VARCHAR(32) NOT NULL,
  product_id VARCHAR(32),
  name VARCHAR(255) NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  qty INT NOT NULL,
  line_total DECIMAL(10,2) NOT NULL,
  personalise_lines TEXT,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS messages (
  id VARCHAR(32) PRIMARY KEY,
  customer_username VARCHAR(64) NOT NULL,
  customer_name VARCHAR(128),
  sender ENUM('customer','admin') NOT NULL,
  body TEXT NOT NULL,
  read_by_admin BOOLEAN DEFAULT FALSE,
  read_by_customer BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_username) REFERENCES users(username) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Seed an admin account. Password below is "changeme123" hashed with bcrypt (cost 10).
-- Generate your own with: node -e "console.log(require('bcryptjs').hashSync('yourpassword',10))"
INSERT IGNORE INTO users (username, name, password_hash, role)
VALUES ('admin', 'Store Admin', '$2a$10$CwTycUXWue0Thq9StjUM0uJ8dsPYwEqZ2VDW9NcbP1jbBLxCoLPES', 'admin');

-- Seed products matching the current front-end demo data
INSERT IGNORE INTO products (id, name, category, description, price, discount, stock, personalise, lines) VALUES
('p1','Amber & Cedarwood Candle','candles','Hand-poured soy wax in a reusable glass jar. Approx. 40 hour burn.',18.00,0,34,FALSE,0),
('p2','Fireside Spice Candle','candles','A warm blend of clove, orange peel and smoked vanilla.',16.00,15,20,FALSE,0),
('p3','Engraved Name Candle','candles','Our classic jar candle with a name or short message engraved into the glass.',22.00,0,15,TRUE,1),
('p4','Walnut Wall Clock','clocks','Solid walnut face with brushed brass hands, silent sweep movement.',74.00,0,9,FALSE,0),
('p5','Oak Mantel Clock','clocks','Compact oak mantel clock, hand-finished with a natural oil.',58.00,10,12,FALSE,0),
('p6','Engraved Anniversary Clock','clocks','A walnut wall clock with a message engraved into the base.',89.00,0,6,TRUE,2),
('p7','Oak Photo Frame, 6x4"','frames','Solid oak frame with a single engraved line along the base.',24.00,0,25,TRUE,1),
('p8','Walnut Family Frame, 8x10"','frames','A larger walnut frame with space for up to three engraved lines.',36.00,20,10,TRUE,3),
('p9','Pet Memorial Frame','frames','A gentle keepsake frame with two engraved lines for a name and dates.',29.00,0,14,TRUE,2);