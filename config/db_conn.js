const { Pool } = require('pg');
require('dotenv').config();  // To load environment variables from the .env file

// SSL Certificate from the second block
const sslConfig = {
  rejectUnauthorized: true,
  ca: `-----BEGIN CERTIFICATE-----
MIIEUDCCArigAwIBAgIUHcLTp4XBlronfHosVErLLetlb3QwDQYJKoZIhvcNAQEM
BQAwQDE+MDwGA1UEAww1NzY5ODE0NmEtZmY3Ni00NzRlLTkyYmUtNjA1NDA3YmU4
ZjllIEdFTiAxIFByb2plY3QgQ0EwHhcNMjUxMTA3MTEyOTI0WhcNMzUxMTA1MTEy
OTI0WjBAMT4wPAYDVQQDDDU3Njk4MTQ2YS1mZjc2LTQ3NGUtOTJiZS02MDU0MDdi
ZThmOWUgR0VOIDEgUHJvamVjdCBDQTCCAaIwDQYJKoZIhvcNAQEBBQADggGPADCC
AYoCggGBAI2+Y91VVcxzZHIAFpgzHrQXj1GIMhVDG+vaTsYOYu2WQI0jiGYus4E+
ngF8xCpjr+uVrXdL9wbVLxqYPMVGT2+0AoyCiJh0sKBwdqr+g6LiluCzd+mP+ACZ
oqItmq730kCIuT1v2twmIA5+4pQ5jFau4nqezU3aKKs7AY0mw5Yf8POvMOcwl2wS
BH06xn9ibBiwYMgcth+or5sdK8F6o2h/CHnjcE13jAdLF5zZEoh78innVYrL3A0y
K3j0EiRQs38QpJpCCqFO/lbmjHN7HkfkzC10h78v5Atk4Job8Wh7T+ovmD4upmA0
YqKeAgqbkcl5okv9y6O78Ueg7mDw37bGlj4aynTKZwkRbvpMN/kHoaEc1RsKsqgM
34E+dT2bSYL+v177WNBJW5dX51IWn9FteE4qR7vACE2gi0wAmnVRFadUVaQG2uEY
EuWEHG2gQiDrG7SjYNIDKmkcr56erA7Ej1xOgq2lu3femLmwzVJLG8rdFyf/XUWP
buYuZUuUcQIDAQABo0IwQDAdBgNVHQ4EFgQU9C4EytyIrX42egayQvpvRTHv1ngw
EgYDVR0TAQH/BAgwBgEB/wIBADALBgNVHQ8EBAMCAQYwDQYJKoZIhvcNAQEMBQAD
ggGBAAabz2Lxum/0xf4KUyAGYEFs5nwV7D8thsYBNjBcoMcNYeZ0il/F74zvwCOO
eozocEmb7bfr9EQQTxoKs5hFZI2ssfX1cIX0RCiUPvUNTSqcYCM8DwywEtJgTOAy
o3XplsqRrnjcEAF6vs7Z7DGXpEwyCuZwsgW81K4A5u3D8aDl71vxPP7NQ/pPx1bc
oAPw617tvCOdGYQf9rOZzD6gN3S/3NFF0bDtX+ystr3AVzCLvBJqMZCkA7vB63gZ
2juJs3Mj6GEXcL4trst+hFERYdVL6pr3bPFxKqBBKUUQWvRgWnwHpTMAPWP18GjI
BR0k0CIqCvu2829FKStb56cjRv38BaKg7O0sosZvqKoiR4GIbmmxPGc+1+ijn6jh
zqcCT66ePU4LhiFm4kbDHjxKSx4nHO+ONgH1a5RksVGmpBz5Kdfell0rImkFk0IY
tgrnSgmFQdoVswYz9MaAiXz92shty8K2/rJYrvMiTo9JcjzN7nuF44Zf+0XyrGzT
6Jjbrg==
-----END CERTIFICATE-----`
};

// Create a new pool instance with SSL settings
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: sslConfig  // Added SSL configuration
});

// Handle pool errors
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

// Export pool for external use
module.exports = pool;
