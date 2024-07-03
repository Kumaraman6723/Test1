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
function sendToWebhook(data) {
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
        logEvent(
          "Error",
          `Error updating profile for user ${id}: ${err.message}`
        );
        return res.status(500).send("Error updating profile.");
      }
      logEvent("Info", `Profile updated successfully for user ${id}.`);
      res.json({ message: "Profile updated successfully." });

      // Send webhook for profile update
      const webhookData = {
        event: "profile_updated",
        user: {
          id,
          name,
          email,
          gender,
          birthday,
          profilepicture,
          countryCode,
          contact,
        },
      };
      sendToWebhook(webhookData);
    }
  );
});

// Route to update company information
app.post("/updateCompanyInfo", (req, res) => {
  const { email, orgName, position } = req.body;

  // SQL query to update company info
  const updateQuery = `
    UPDATE users 
    SET orgName = ?,
        position = ?
    WHERE email = ?
  `;

  // Execute query
  db.query(updateQuery, [orgName, position, email], (err, result) => {
    if (err) {
      console.error("Error updating company info:", err);
      logEvent(
        "Error",
        `Error updating company info for user ${email}: ${err.message}`
      );
      return res.status(500).send("Error updating company info.");
    }
    logEvent("Info", `Company info updated successfully for user ${email}.`);
    res.json({ message: "Company info updated successfully." });

    // Send webhook for company info update
    const webhookData = {
      event: "company_info_updated",
      user: { email, orgName, position },
    };
    sendToWebhook(webhookData);
  });
});

// Route to store user token
app.post("/storeToken", (req, res) => {
  const { token, email } = req.body;

  // SQL query to update user token
  const updateTokenQuery = `
    UPDATE users 
    SET token = ?
    WHERE email = ?
  `;

  // Execute query
  db.query(updateTokenQuery, [token, email], (err, result) => {
    if (err) {
      console.error("Error storing token:", err);
      logEvent(
        "Error",
        `Error storing token for user ${email}: ${err.message}`
      );
      return res.status(500).send("Error storing token.");
    }
    logEvent("Info", `Token stored successfully for user ${email}.`);
    res.json({ message: "Token stored successfully." });

    // Send webhook for token store
    const webhookData = {
      event: "token_stored",
      user: { email, token },
    };
    sendToWebhook(webhookData);
  });
});

// Route to fetch user token
app.get("/fetchToken/:email", (req, res) => {
  const { email } = req.params;
  const fetchTokenQuery = "SELECT token FROM users WHERE email = ?";
  db.query(fetchTokenQuery, [email], (err, result) => {
    if (err) {
      console.error("Error fetching token:", err);
      logEvent(
        "Error",
        `Error fetching token for user ${email}: ${err.message}`
      );
      return res.status(500).send("Error fetching token.");
    }
    if (result.length > 0) {
      logEvent("Info", `Token fetched successfully for user ${email}.`);
      res.json({ token: result[0].token });

      // Send webhook for token fetch
      const webhookData = {
        event: "token_fetched",
        user: { email, token: result[0].token },
      };
      sendToWebhook(webhookData);
    } else {
      logEvent("Info", `Token not found for user ${email}.`);
      res.status(404).json({ error: "Token not found." });

      // Send webhook for token not found
      const webhookData = {
        event: "token_not_found",
        user: { email },
      };
      sendToWebhook(webhookData);
    }
  });
});

// Route to update user token
app.put("/updateToken/:email", (req, res) => {
  const { email } = req.params;
  const { token } = req.body;

  // SQL query to update user token
  const updateTokenQuery = `
    UPDATE users 
    SET token = ?
    WHERE email = ?
  `;

  // Execute query
  db.query(updateTokenQuery, [token, email], (err, result) => {
    if (err) {
      console.error("Error updating token:", err);
      logEvent(
        "Error",
        `Error updating token for user ${email}: ${err.message}`
      );
      return res.status(500).send("Error updating token.");
    }
    logEvent("Info", `Token updated successfully for user ${email}.`);
    res.json({ message: "Token updated successfully." });

    // Send webhook for token update
    const webhookData = {
      event: "token_updated",
      user: { email, token },
    };
    sendToWebhook(webhookData);
  });
});

// Route to fetch company information by email
app.get("/fetchCompanyInfo/:email", (req, res) => {
  const email = req.params.email;

  // SQL query to fetch company info
  const fetchCompanyQuery =
    "SELECT orgName, position FROM users WHERE email = ?";
  db.query(fetchCompanyQuery, [email], (err, result) => {
    if (err) {
      console.error("Error fetching company info:", err);
      logEvent(
        "Error",
        `Error fetching company info for user ${email}: ${err.message}`
      );
      return res.status(500).json({ error: "Internal server error" });
    }
    if (result.length === 0) {
      logEvent("Info", `Company info not found for user ${email}.`);
      return res.status(404).json({ error: "Company info not found" });
    }

    const companyInfo = {
      orgName: result[0].orgName,
      position: result[0].position,
      // Add other fields if needed
    };

    logEvent("Info", `Company info fetched successfully for user ${email}.`);
    res.json(companyInfo);

    // Send webhook for company info fetch
    const webhookData = {
      event: "company_info_fetched",
      user: { email, orgName: result[0].orgName, position: result[0].position },
    };
    sendToWebhook(webhookData);
  });
});

// Route to save device data
app.post("/saveDeviceData", (req, res) => {
  const { email, deviceId, deviceCount } = req.body;

  // Replace with your database insertion logic
  // Example SQL query to insert device data into a database
  const insertDeviceQuery = `
    INSERT INTO devices (email, deviceId, deviceCount)
    VALUES (?, ?, ?)
  `;

  // Execute query using your database library (e.g., MySQL, PostgreSQL, etc.)
  db.query(insertDeviceQuery, [email, deviceId, deviceCount], (err, result) => {
    if (err) {
      console.error("Error saving device data:", err);
      return res.status(500).send("Error saving device data.");
    }
    console.log("Device data saved successfully.");
    res.json({ message: "Device data saved successfully." });

    // Send webhook for device data save
    const webhookData = {
      event: "device_data_saved",
      device: { email, deviceId, deviceCount },
    };
    sendToWebhook(webhookData);
  });
});

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
