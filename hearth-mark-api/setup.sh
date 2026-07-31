#!/usr/bin/env bash
# Hearth & Mark — one-shot setup
# Run this from inside the hearth-mark-api folder: bash setup.sh
set -e

echo "This will create a MariaDB user + database, and set up the API server."
echo "You'll be asked for your MariaDB root password (the one you set during install)."
echo

read -p "Choose a password for the new 'hearthmark' database user: " -s DB_PASS
echo
read -p "Confirm that password: " -s DB_PASS_CONFIRM
echo

if [ "$DB_PASS" != "$DB_PASS_CONFIRM" ]; then
  echo "Passwords didn't match. Run the script again."
  exit 1
fi

echo
echo "Creating database and user..."
mysql -u root -p <<SQL
CREATE DATABASE IF NOT EXISTS hearth_mark CHARACTER SET utf8mb4;
CREATE USER IF NOT EXISTS 'hearthmark'@'localhost' IDENTIFIED BY '${DB_PASS}';
GRANT ALL PRIVILEGES ON hearth_mark.* TO 'hearthmark'@'localhost';
FLUSH PRIVILEGES;
SQL

echo "Loading schema (tables + seed data)..."
mysql -u hearthmark -p"${DB_PASS}" hearth_mark < schema.sql

echo "Installing Node dependencies..."
npm install

echo "Generating a random JWT secret..."
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")

cat > .env <<ENV
DB_HOST=localhost
DB_PORT=3306
DB_USER=hearthmark
DB_PASSWORD=${DB_PASS}
DB_NAME=hearth_mark
JWT_SECRET=${JWT_SECRET}
PORT=4000
CORS_ORIGIN=http://localhost:5500
ENV

echo
echo "Done. .env has been created with your settings."
echo
echo "IMPORTANT: the seeded admin login is username 'admin', password 'changeme123'."
echo "Change it now by running:"
echo "  node -e \"console.log(require('bcryptjs').hashSync('your-new-password', 10))\""
echo "and updating the password_hash column for the admin row in the users table."
echo
echo "Start the server with: npm start"