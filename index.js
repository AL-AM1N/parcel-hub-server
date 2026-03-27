const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

//load environment variable from .env file
dotenv.config();

const stripe = require("stripe")(process.env.PAYMENT_GATEWAY_KEY);
const admin = require("firebase-admin");

const app = express();
const PORT = process.env.PORT || 3000;

// middleware
app.use(cors());
app.use(express.json());

const serviceAccount = require("./firebase-admin-key.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.rmwu2kp.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();

    const db = client.db("parcelDB");
    const usersCollection = db.collection("users");
    const parcelsCollection = db.collection("parcels");
    const trackingsCollection = db.collection("tracking");
    const paymentsCollection = db.collection("payments");
    const ridersCollection = db.collection("riders");

    console.log("Connected to MongoDB ✅");

    // custom middlewares
    const verifyFBToken = async (req, res, next) => {
      //console.log("hearders in middleware", req.headers);
      const authHeader = req.headers.authorization;

      if (!authHeader) {
        return res.status(401).send({ message: "unauthorized access" });
      }
      const token = authHeader.split(" ")[1];
      if (!token) {
        return res.status(401).send({ message: "unauthorized access" });
      }

      //verify the token
      try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.decoded = decoded;
        next();
      } catch {
        return res.status(401).send({ message: "forbidden access" });
      }
    };

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email };
      const user = await usersCollection.findOne(query);

      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    const verifyRider = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email };
      const user = await usersCollection.findOne(query);

      if (!user || user.role !== "rider") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    app.get("/users/search", async (req, res) => {
      const emailQuery = req.query.email;

      if (!emailQuery) {
        return res.status(400).send({ error: "Search query is required" });
      }

      const regex = new RegExp(emailQuery, "i"); // case-insensitive partical match

      try {
        const users = await usersCollection
          .find({ email: { $regex: regex } })
          .limit(10) //important (avoid loading too much)
          .toArray();

        res.send(users);
      } catch (error) {
        console.error("Error searching users:", error);
        res.status(500).send({ error: "Failed to search users" });
      }
    });

    app.patch(
      "/users/:id/role",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const { id } = req.params;
        const { role } = req.body;

        // allowed roles
        if (!["admin", "user"].includes(role)) {
          return res.status(400).send({ error: "Invalid role" });
        }

        try {
          const result = await usersCollection.updateOne(
            { _id: new ObjectId(id) },
            {
              $set: { role },
            },
          );

          res.send({
            message: `User role updated to ${role}`,
            result,
          });
        } catch (error) {
          console.error("Error updating role:", error);
          res.status(500).send({ error: "Failed to update role" });
        }
      },
    );

    // GET: Get user role by email
    app.get("/users/:email/role", async (req, res) => {
      try {
        const email = req.params.email;

        const user = await usersCollection.findOne({ email });

        if (!user) {
          return res.status(404).send({ error: "User not found" });
        }

        res.send({
          role: user.role || "user",
        });
      } catch (error) {
        console.error("Error getting role:", error);
        res.status(500).send({ error: "Failed to get role" });
      }
    });

    app.post("/users", async (req, res) => {
      const email = req.body.email;
      const userExits = await usersCollection.findOne({ email });
      if (userExits) {
        return res
          .status(200)
          .send({ message: "User already exists", inserted: false });
      }
      const user = req.body;
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    // app.get("/parcels", async (req, res) => {
    //   const result = await parcelsCollection.find().toArray();
    //   res.send(result);
    // });

    // parcels api
    app.get("/parcels", verifyFBToken, async (req, res) => {
      try {
        const { email, payment_status, delivery_status } = req.query;

        let query = {};
        if (email) {
          query = { created_by: email };
        }

        if (payment_status) {
          query.payment_status = payment_status;
        }
        if (delivery_status) {
          query.delivery_status = delivery_status;
        }

        // const query = userEmail ? { created_by: userEmail } : {};
        const options = {
          sort: { createdAt: -1 }, // newest first
        };

        const parcels = await parcelsCollection.find(query, options).toArray();
        res.send(parcels);
      } catch (error) {
        console.error("Error fatching parcels:", error);
      }
    });

    app.get("/parcels/track/:trackingId", async (req, res) => {
      const trackingId = req.params.trackingId;

      const parcel = await parcelsCollection.findOne({
        tracking_id: trackingId,
      });

      res.send(parcel);
    });

    // GET single parcel by id
    app.get("/parcels/:id", async (req, res) => {
      try {
        const id = req.params.id;

        const query = { _id: new ObjectId(id) };

        const parcel = await parcelsCollection.findOne(query);

        if (!parcel) {
          return res.status(404).send({ message: "Parcel not found" });
        }

        res.send(parcel);
      } catch (error) {
        console.error("Error fetching parcel:", error);
        res.status(500).send({ error: "Failed to fetch parcel" });
      }
    });

    app.get("/parcels/delivery/status-count", async (req, res) => {
      const pipeline = [
        {
          $group: {
            _id: "$delivery_status",
            count: {
              $sum: 1,
            },
          },
        },
        {
          $project: {
            status: "$_id",
            count: 1,
            _id: 0,
          },
        },
      ];

      try {
        const result = await parcelsCollection.aggregate(pipeline).toArray();

        res.send(result);
      } catch (error) {
        console.error("Error counting status:", error);
        res.status(500).send({ error: "Failed to count statuses" });
      }
    });

    app.get("/rider/parcels", verifyFBToken, verifyRider, async (req, res) => {
      try {
        const email = req.query.email;

        if (!email) {
          return res.status(400).send({ error: "Rider email is required" });
        }

        const query = {
          assigned_rider_email: email,
          delivery_status: { $in: ["rider_assigned", "in_transit"] },
        };

        const options = {
          sort: { assigned_at: -1 }, // latest assigned first
        };

        const parcels = await parcelsCollection.find(query, options).toArray();

        res.send(parcels);
      } catch (error) {
        console.error("Error fetching rider parcels:", error);
        res.status(500).send({ error: "Failed to fetch rider parcels" });
      }
    });

    app.get(
      "/rider/completed-parcels",
      verifyFBToken,
      verifyRider,
      async (req, res) => {
        try {
          const email = req.query.email;

          if (!email) {
            return res.status(400).send({ error: "Rider email is required" });
          }

          const query = {
            assigned_rider_email: email,
            delivery_status: {
              $in: ["delivered", "service_center_delivered"],
            },
          };

          const options = {
            sort: { delivered_at: -1 }, // latest completed first
          };

          const parcels = await parcelsCollection
            .find(query, options)
            .toArray();

          res.send(parcels);
        } catch (error) {
          console.error("Error fetching completed deliveries:", error);
          res
            .status(500)
            .send({ error: "Failed to fetch completed deliveries" });
        }
      },
    );

    // create a new parcel
    app.post("/parcels", async (req, res) => {
      const parcel = req.body;
      const result = await parcelsCollection.insertOne(parcel);
      res.send(result);
    });

    app.patch("/parcels/:id/assign", async (req, res) => {
      try {
        const { id } = req.params;
        const { riderId, riderName, riderEmail } = req.body;

        const parcelFilter = { _id: new ObjectId(id) };

        // Update Parcel
        const parcelUpdate = await parcelsCollection.updateOne(parcelFilter, {
          $set: {
            assigned_rider_id: riderId,
            assigned_rider_name: riderName,
            assigned_rider_email: riderEmail,
            delivery_status: "rider_assigned",
            assigned_at: new Date(),
          },
        });

        // Update Rider Status
        const riderUpdate = await ridersCollection.updateOne(
          { _id: new ObjectId(riderId) },
          {
            $set: {
              work_status: "in-delivery",
            },
          },
        );

        res.send({
          success: true,
          message: "Rider assigned successfully",
          parcelUpdate,
          riderUpdate,
        });
      } catch (error) {
        console.error("Assign rider error:", error);
        res.status(500).send({ message: "Failed to assign rider" });
      }
    });

    app.patch("/parcels/:id/status", async (req, res) => {
      const parcelId = req.params.id;
      const { status } = req.body;
      const updatedDoc = {
        delivery_status: status,
      };

      if (status === "in_transit") {
        updatedDoc.picked_at = new Date().toISOString();
      } else if (status === "delivered") {
        updatedDoc.delivered_at = new Date().toISOString();
      }

      const result = await parcelsCollection.updateOne(
        { _id: new ObjectId(parcelId) },
        {
          $set: updatedDoc,
        },
      );

      res.send(result);
    });

    app.patch("/parcels/:id/cashout", async (req, res) => {
      const id = req.params.id;
      const result = await parcelsCollection.updateOne(
        {
          _id: new ObjectId(id),
        },
        {
          $set: {
            cashout_status: "cashed_out",
            cashed_out_at: new Date(),
          },
        },
      );
      res.send(result);
    });

    // DELETE parcel
    app.delete("/parcels/:id", async (req, res) => {
      try {
        const id = req.params.id;

        const query = { _id: new ObjectId(id) };

        const result = await parcelsCollection.deleteOne(query);

        res.send(result);
      } catch (error) {
        console.error("Error deleting parcel:", error);
        res.status(500).send({ error: "Failed to delete parcel" });
      }
    });

    app.get("/trackings/:trackingId", async (req, res) => {
      const trackingId = req.params.trackingId;

      const updates = await trackingsCollection
        .find({ tracking_id: trackingId })
        .sort({ timestamp: 1 }) // oldest → newest
        .toArray();

      res.send(updates);
    });

    app.post("/trackings", async (req, res) => {
      const update = req.body;

      update.timestamp = new Date();
      if (!update.tracking_id || !update.status) {
        return res
          .status(400)
          .json({ message: "tracking_id and status are required" });
      }

      const result = await trackingsCollection.insertOne(update);
      res.status(201).json(result);
    });

    app.post("/riders", async (req, res) => {
      const rider = req.body;
      const result = await ridersCollection.insertOne(rider);
      res.send(result);
    });

    app.get("/riders/pending", verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const query = { status: "pending" };

        const options = {
          sort: { created_at: -1 }, // newest first
        };

        const pendingRiders = await ridersCollection
          .find(query, options)
          .toArray();

        res.send(pendingRiders);
      } catch (error) {
        console.error("Error fetching pending riders:", error);
        res.status(500).send({ error: "Failed to fetch pending riders" });
      }
    });

    app.get("/riders/active", verifyFBToken, verifyAdmin, async (req, res) => {
      const result = await ridersCollection
        .find({ status: "active" })
        .toArray();

      res.send(result);
    });

    // GET eligible riders
    app.get("/riders/available", async (req, res) => {
      try {
        const { district } = req.query;

        const riders = await ridersCollection.find({ district }).toArray();

        res.send(riders);
      } catch (error) {
        console.error("Error fetching eligible riders:", error);
        res.status(500).send({ message: "Failed to fetch riders" });
      }
    });

    app.patch("/riders/:id/status", async (req, res) => {
      const { id } = req.params;
      const { status, email } = req.body;

      const query = { _id: new ObjectId(id) };

      // update rider status
      const updateDoc = {
        $set: {
          status: status,
        },
      };

      try {
        const result = await ridersCollection.updateOne(query, updateDoc);

        // update user role for accepting rider
        if (status === "active") {
          const userQuery = { email };
          const userUpdateDoc = {
            $set: {
              role: "rider",
            },
          };
          const roleResult = await usersCollection.updateOne(
            userQuery,
            userUpdateDoc,
          );
          console.log(roleResult.matchedCount);
        }

        res.send(result);
      } catch (error) {
        console.error("Error updating rider status:", error);
        res.status(500).send({ error: "Failed to update rider status" });
      }
    });

    // app.post("/tracking", async (req, res) =>{
    //   const {tracking_id, parcel_id, status, message, updated_by=''} = req.body;

    //   const log = {
    //     tracking_id,
    //     parcel_id: parcel_id? new ObjectId(parcel_id) : undefined,
    //     status,
    //     message,
    //     time: new Date(),
    //     updated_by,
    //   };

    //   const result = await trackingsCollection.insertOne(log);
    //   res.send({success: true, insertedId: result.insertedId});
    // });

    app.get("/payments", verifyFBToken, async (req, res) => {
      try {
        const userEmail = req.query.email;

        console.log("decoded", req.decoded);
        if (req.decoded.email !== userEmail) {
          return res.status(401).send({ message: "forbidden access" });
        }

        const query = userEmail ? { email: userEmail } : {};

        const options = {
          sort: { paid_at: -1 }, //newest first
        };

        const payments = await paymentsCollection
          .find(query, options)
          .toArray();

        res.send(payments);
      } catch (error) {
        console.error("Error fetching payments:", error);
        res.status(500).send({ error: "Failed to fetch payments" });
      }
    });

    // save payment & update parcel
    app.post("/payments", async (req, res) => {
      try {
        const { parcelId, email, amount, paymentMethod, transactionId } =
          req.body;

        // update parcel payment status
        const query = { _id: new ObjectId(parcelId) };

        const updateDoc = {
          $set: {
            payment_status: "paid",
            transactionId: transactionId,
          },
        };

        const updateResult = await parcelsCollection.updateOne(
          query,
          updateDoc,
        );

        if (updateResult.modifiedCount === 0) {
          return res
            .status(404)
            .send({ message: "parcel not found or already paid" });
        }

        // 2. insert payment record
        const paymentDoc = {
          parcelId,
          email,
          amount,
          paymentMethod,
          transactionId,
          paid_at_string: new Date().toISOString(),
          paid_at: new Date(),
        };

        // save payment history
        const paymentResult = await paymentsCollection.insertOne(paymentDoc);

        res.send({
          success: true,
          paymentResult,
          updateResult,
        });
      } catch (error) {
        console.error("Payment save error:", error);
        res.status(500).send({ error: "Failed to save payment" });
      }
    });

    app.post("/create-payment-intent", async (req, res) => {
      try {
        const amountInCents = req.body.amountInCents;

        const paymentIntent = await stripe.paymentIntents.create({
          amount: amountInCents, // Stripe uses cents
          currency: "usd",
          payment_method_types: ["card"],
        });

        res.send({
          clientSecret: paymentIntent.client_secret,
        });
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("ParcelHub Server is Running 🚚");
});

// start server
app.listen(PORT, () => {
  console.log(`ParcelHub server running on port ${PORT}`);
});
