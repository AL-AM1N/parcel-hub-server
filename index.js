const express = require("express");
const cors = require("cors");
const dotenv = require('dotenv');

//load environment variable from .env file
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// middleware
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("ParcelHub Server is Running 🚚");
});

// start server
app.listen(PORT, () => {
  console.log(`ParcelHub server running on port ${PORT}`);
});