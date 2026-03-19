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
    const paymentsCollection = db.collection("payments");
    const ridersCollection = db.collection("riders");

    console.log("Connected to MongoDB ✅");

    // custom middlewares
    const varifyFBToken = async (req, res, next) => {
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
    app.get("parcels", varifyFBToken, async (req, res) => {
      try {
        const userEmail = req.query.email;
        const query = userEmail ? { created_by: userEmail } : {};
        const options = {
          sort: { createdAt: -1 }, // newest first
        };

        const parcels = await parcelsCollection.find(query, options).toArray();
        res.send(parcels);
      } catch (error) {
        console.error("Error fatching parcels:", error);
      }
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

    app.post("/parcels", async (req, res) => {
      const parcel = req.body;
      const result = await parcelsCollection.insertOne(parcel);
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

    app.post("/riders", async (req, res) => {
      const rider = req.body;
      const result = await ridersCollection.insertOne(rider);
      res.send(result);
    });

    app.get("/riders/pending", async (req, res) => {
      try {
        const query = { status: "pending" };

        const options = {
          sort: { created_at: -1 }, // newest first
        };

        const pendingRiders = await ridersCollection.find(query, options).toArray();

        res.send(pendingRiders);
      } catch (error) {
        console.error("Error fetching pending riders:", error);
        res.status(500).send({ error: "Failed to fetch pending riders" });
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

    //   const result = await trackingCollection.insertOne(log);
    //   res.send({success: true, insertedId: result.insertedId});
    // });

    app.get("/payments", varifyFBToken, async (req, res) => {
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
