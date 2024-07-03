const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const mysql = require("mysql2");
const axios = require("axios");

const app = express();
const port = 3001;
const webhookUrl = "http://localhost:3002/webhook"; // Change to your webhook URL

// Middleware
app.use(cors()); // Enable Cross-Origin Resource Sharing (CORS)
app.use(bodyParser.json({ limit: "50mb" })); // Parse JSON requests with size limit
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true })); // Parse URL-encoded requests with size limit

// MySQL Connection
const db = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "1234",
  database: "auth_db",
});

// Connect to MySQL
db.connect((err) => {
  if (err) {
    console.error("Error connecting to the database:", err);
    return;
  }
  console.log("Connected to the database.");
});

// Create Users table query
const createUsersTableQuery = `
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(255) PRIMARY KEY,
    email VARCHAR(255),
    name VARCHAR(255),
    gender VARCHAR(50),
    birthday DATE,
    password VARCHAR(255),
    token VARCHAR(255),
    orgName VARCHAR(255),
    position VARCHAR(255),
    countryCode VARCHAR(10),
    contact VARCHAR(20),
    profilepicture TEXT
);
`;

// Create Logs table query
const createLogsTableQuery = `
CREATE TABLE IF NOT EXISTS logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    eventType VARCHAR(100),
    eventDescription TEXT
);
`;

// Create Devices table query
const createDevicesTableQuery = `
CREATE TABLE IF NOT EXISTS devices (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255),
    deviceId VARCHAR(255),
    deviceCount INT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

// Execute create table queries
db.query(createUsersTableQuery, (err, result) => {
  if (err) {
    console.error("Error creating users table:", err);
    return;
  }
  console.log("Users table created or already exists.");
});

db.query(createLogsTableQuery, (err, result) => {
  if (err) {
    console.error("Error creating logs table:", err);
    return;
  }
  console.log("Logs table created or already exists.");
});

db.query(createDevicesTableQuery, (err, result) => {
  if (err) {
    console.error("Error creating devices table:", err);
    return;
  }
  console.log("Devices table created or already exists.");
});
const createWebhooksTableQuery = `
CREATE TABLE IF NOT EXISTS webhooks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_email VARCHAR(255),
    event VARCHAR(255),
    data TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

// Execute create webhooks table query
db.query(createWebhooksTableQuery, (err, result) => {
  if (err) {
    console.error("Error creating webhooks table:", err);
    return;
  }
  console.log("Webhooks table created or already exists.");
});

function sendToWebhook(data) {
  if (!data.user || !data.user.email) {
    console.error("Invalid webhook data:", data);
    return;
  }
  const { user } = data;

  // Save webhook data to the database
  const insertWebhookQuery = `
    INSERT INTO webhooks (user_email, event, data)
    VALUES (?, ?, ?)
  `;
  const webhookDataString = JSON.stringify(data);

  db.query(
    insertWebhookQuery,
    [user.email, data.event, webhookDataString],
    (err, result) => {
      if (err) {
        console.error("Error saving webhook data:", err);
        return;
      }
      console.log("Webhook data saved successfully to the database.");
    }
  );

  // Send webhook to the external URL
  axios
    .post(webhookUrl, data)
    .then((response) => {
      console.log(`Webhook sent successfully: ${response.status}`);
    })
    .catch((error) => {
      console.error(`Error sending webhook: ${error.message}`);
    });
}

// Function to log events into the Logs table
function logEvent(eventType, eventDescription) {
  const insertLogQuery = `
    INSERT INTO logs (eventType, eventDescription)
    VALUES (?, ?)
  `;
  db.query(insertLogQuery, [eventType, eventDescription], (err, result) => {
    if (err) {
      console.error("Error inserting log:", err);
    }
  });
}

// Route to check if a user exists based on email
app.post("/checkUser", (req, res) => {
  const { email } = req.body;
  const checkQuery = "SELECT * FROM users WHERE email = ?";
  db.query(checkQuery, [email], (err, results) => {
    if (err) {
      console.error("Error checking user:", err);
      logEvent("Error", `Error checking user: ${err.message}`);
      return res.status(500).send("Error checking user.");
    }
    if (results.length > 0) {
      logEvent("Info", `User with email ${email} found.`);
      res.json({ exists: true, userInfo: results[0] });

      // Send webhook for user check
      const webhookData = {
        event: "user_checked",
        user: { email },
      };
      sendToWebhook(webhookData);
    } else {
      logEvent("Info", `User with email ${email} not found.`);
      res.json({ exists: false });

      // Send webhook for user not found
      const webhookData = {
        event: "user_not_found",
        user: { email },
      };
      sendToWebhook(webhookData);
    }
  });
});

// Route to store or update authentication information
app.post("/storeAuthInfo", (req, res) => {
  const authInfo = req.body;
  const { id, email, name, gender, birthday, password } = authInfo;

  // Validate required fields
  if (!id || !email || !name || !gender || !birthday || !password) {
    console.error("Missing required auth info fields:", authInfo);
    logEvent(
      "Error",
      `Missing required auth info fields: ${JSON.stringify(authInfo)}`
    );
    return res.status(400).send("Missing required auth info fields.");
  }

  // SQL query to insert or update user information
  const insertQuery = `
    INSERT INTO users (id, email, name, gender, birthday, password)
    VALUES (?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
    email = VALUES(email),
    name = VALUES(name),
    gender = VALUES(gender),
    birthday = VALUES(birthday),
    password = VALUES(password);
  `;

  // Execute query
  db.query(
    insertQuery,
    [id, email, name, gender, birthday, password],
    (err, result) => {
      if (err) {
        console.error("Error storing or updating auth info:", err);
        logEvent(
          "Error",
          `Error storing or updating auth info: ${err.message}`
        );
        return res.status(500).send("Error storing or updating auth info.");
      }
      logEvent(
        "Info",
        `Auth info for user ${email} stored/updated successfully.`
      );
      res.json({ message: "Auth info received and stored/updated." });

      // Send webhook for user sign-up
      const webhookData = {
        event: "user_signed_up",
        user: { id, email, name, gender, birthday },
      };
      sendToWebhook(webhookData);
    }
  );
});

// Route to fetch recent logs
app.get("/logs", (req, res) => {
  const fetchLogsQuery =
    "SELECT timestamp, eventType, eventDescription FROM logs ORDER BY timestamp DESC LIMIT 50";

  db.query(fetchLogsQuery, (err, result) => {
    if (err) {
      console.error("Error fetching logs:", err);
      return res.status(500).send("Error fetching logs.");
    }
    res.json(result);

    // Send webhook for fetching logs
    const webhookData = {
      event: "logs_fetched",
      logs: result,
    };
    sendToWebhook(webhookData);
  });
});

// Route to update user profile information
app.post("/updateProfile", (req, res) => {
  const {
    id,
    name,
    email,
    gender,
    birthday,
    password,
    profilepicture,
    countryCode,
    contact,
  } = req.body;

  // SQL query to update user profile
  const updateQuery = `
    UPDATE users 
    SET name = ?,
        email = ?,
        gender = ?,
        birthday = ?,
        password = ?,
        profilepicture = ?,
        countryCode = ?,
        contact = ?
    WHERE id = ?
  `;

  // Execute query
  db.query(
    updateQuery,
    [
      name,
      email,
      gender,
      birthday,
      password,
      profilepicture,
      countryCode,
      contact,
      id,
    ],
    (err, result) => {
      if (err) {
        console.error("Error updating profile:", err);
        logEvent("Error", `Error updating profile: ${err.message}`);
        return res.status(500).send("Error updating profile.");
      }
      logEvent("Info", `Profile for user ${email} updated successfully.`);
      res.json({ message: "Profile updated successfully." });

      // Send webhook for profile update
      const webhookData = {
        event: "profile_updated",
        user: { id, email, name, gender, birthday },
      };
      sendToWebhook(webhookData);
    }
  );
});

// Route to handle device information
app.post("/storeDeviceInfo", (req, res) => {
  const { email, deviceId } = req.body;
  if (!email || !deviceId) {
    return res.status(400).json({ error: "Email and deviceId are required." });
  }

  const fetchDeviceQuery =
    "SELECT * FROM devices WHERE email = ? AND deviceId = ?";
  db.query(fetchDeviceQuery, [email, deviceId], (err, results) => {
    if (err) {
      console.error("Error fetching device information:", err);
      return res
        .status(500)
        .json({ error: "Error fetching device information." });
    }

    if (results.length > 0) {
      // Device exists, update the timestamp and deviceCount
      const updateDeviceQuery =
        "UPDATE devices SET deviceCount = deviceCount + 1, timestamp = CURRENT_TIMESTAMP WHERE email = ? AND deviceId = ?";
      db.query(updateDeviceQuery, [email, deviceId], (err, result) => {
        if (err) {
          console.error("Error updating device information:", err);
          return res
            .status(500)
            .json({ error: "Error updating device information." });
        }
        res.json({ message: "Device information updated successfully." });

        // Send webhook for device update
        const webhookData = {
          event: "device_updated",
          user: { email },
        };
        sendToWebhook(webhookData);
      });
    } else {
      // Device does not exist, insert new record
      const insertDeviceQuery =
        "INSERT INTO devices (email, deviceId, deviceCount) VALUES (?, ?, ?)";
      db.query(insertDeviceQuery, [email, deviceId, 1], (err, result) => {
        if (err) {
          console.error("Error inserting device information:", err);
          return res
            .status(500)
            .json({ error: "Error inserting device information." });
        }
        res.json({ message: "Device information stored successfully." });

        // Send webhook for device insertion
        const webhookData = {
          event: "device_inserted",
          user: { email },
        };
        sendToWebhook(webhookData);
      });
    }
  });
});

// Route to handle token updates
app.post("/updateToken", (req, res) => {
  const { id, token } = req.body;

  // Validate required fields
  if (!id || !token) {
    return res.status(400).send("User ID and token are required.");
  }

  // SQL query to update user token
  const updateTokenQuery = "UPDATE users SET token = ? WHERE id = ?";

  db.query(updateTokenQuery, [token, id], (err, result) => {
    if (err) {
      console.error("Error updating token:", err);
      return res.status(500).send("Error updating token.");
    }
    res.json({ message: "Token updated successfully." });

    // Send webhook for token update
    const webhookData = {
      event: "token_updated",
      user: { id },
    };
    sendToWebhook(webhookData);
  });
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
