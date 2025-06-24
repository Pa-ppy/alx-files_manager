import { promisify } from 'util';
import { createClient } from 'redis';
import { MongoClient, ObjectId } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import imageThumbnail from 'image-thumbnail';
import fs from 'fs';
import path from 'path';
import { Queue } from 'bull';

const fileQueue = new Queue('fileQueue');

// Redis client
const redisClient = createClient();
const redisGetAsync = promisify(redisClient.get).bind(redisClient);

redisClient.on('error', (err) => {
  console.error('Redis Client Error:', err);
});

// MongoDB client
const host = process.env.DB_HOST || 'localhost';
const port = process.env.DB_PORT || 27017;
const dbName = process.env.DB_DATABASE || 'files_manager';

const mongoClient = new MongoClient(`mongodb://${host}:${port}`, {
  useUnifiedTopology: true
});

let db;

mongoClient
  .connect()
  .then(() => {
    db = mongoClient.db(dbName);
  })
  .catch((err) => {
    console.error('MongoDB Connection Error:', err);
  });

fileQueue.process(async (job, done) => {
  const { fileId, userId } = job.data;

  if (!fileId) return done(new Error('Missing fileId'));
  if (!userId) return done(new Error('Missing userId'));

  try {
    const file = await db
      .collection('files')
      .findOne({ _id: new ObjectId(fileId), userId: new ObjectId(userId) });
    if (!file) return done(new Error('File not found'));

    if (file.type !== 'image') return done(); // Only process image files

    const thumbnailSizes = [500, 250, 100];

    await Promise.all(
      thumbnailSizes.map(async (size) => {
        try {
          const thumbnail = await imageThumbnail(file.localPath, {
            width: size
          });
          const thumbnailPath = `${file.localPath}_${size}`;
          await fs.promises.writeFile(thumbnailPath, thumbnail);
        } catch (err) {
          console.error(
            `Error generating thumbnail of size ${size}:`,
            err.message
          );
        }
      })
    );

    done();
  } catch (err) {
    console.error('Error processing job:', err.message);
    done(err);
  }
});
