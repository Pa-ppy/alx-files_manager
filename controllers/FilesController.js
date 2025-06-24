import { v4 as uuidv4 } from 'uuid';
import { promises as fs } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { ObjectId } from 'mongodb';
import dbClient from '../utils/db';
import redisClient from '../utils/redis';

const folderPath = process.env.FOLDER_PATH || '/tmp/files_manager';

class FilesController {
  static async postUpload (req, res) {
    const token = req.header('X-Token');
    const key = `auth_${token}`;
    const userId = await redisClient.get(key);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { name, type, parentId = 0, isPublic = false, data } = req.body;

    if (!name) return res.status(400).json({ error: 'Missing name' });
    if (!type || !['folder', 'file', 'image'].includes(type)) {
      return res.status(400).json({ error: 'Missing type' });
    }

    if (type !== 'folder' && !data) { return res.status(400).json({ error: 'Missing data' }); }

    if (parentId !== 0) {
      const parent = await dbClient.db
        .collection('files')
        .findOne({ _id: ObjectId(parentId) });
      if (!parent) return res.status(400).json({ error: 'Parent not found' });
      if (parent.type !== 'folder') { return res.status(400).json({ error: 'Parent is not a folder' }); }
    }

    const fileDocument = {
      userId: ObjectId(userId),
      name,
      type,
      isPublic,
      parentId: parentId === 0 ? 0 : ObjectId(parentId)
    };

    if (type === 'folder') {
      const result = await dbClient.db
        .collection('files')
        .insertOne(fileDocument);
      return res.status(201).json({
        id: result.insertedId,
        ...fileDocument
      });
    }

    await mkdir(folderPath, { recursive: true });
    const fileName = uuidv4();
    const localPath = path.join(folderPath, fileName);
    const buffer = Buffer.from(data, 'base64');
    await writeFile(localPath, buffer);

    fileDocument.localPath = localPath;
    const result = await dbClient.db
      .collection('files')
      .insertOne(fileDocument);

    res.status(201).json({
      id: result.insertedId,
      ...fileDocument
    });
  }

  static async getShow (req, res) {
    const token = req.header('X-Token');
    const userId = await redisClient.get(`auth_${token}`);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const file = await dbClient.db.collection('files').findOne({
      _id: new ObjectId(req.params.id),
      userId: new ObjectId(userId)
    });

    if (!file) return res.status(404).json({ error: 'Not found' });

    const { _id, ...rest } = file;
    res.status(200).json({ id: _id, ...rest });
  }

  static async getIndex (req, res) {
    const token = req.header('X-Token');
    const userId = await redisClient.get(`auth_${token}`);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const parentId = req.query.parentId || '0';
    const page = Number(req.query.page) || 0;

    const match = {
      userId: new ObjectId(userId),
      parentId: parentId === '0' ? 0 : new ObjectId(parentId)
    };
    const files = await dbClient.db
      .collection('files')
      .aggregate([{ $match: match }, { $skip: page * 20 }, { $limit: 20 }])
      .toArray();

    const formatted = files.map(({ _id, ...rest }) => ({ id: _id, ...rest }));
    res.status(200).json(formatted);
  }

  static async putPublish (req, res) {
    const token = req.header('X-Token');
    const userId = await redisClient.get(`auth_${token}`);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const fileId = req.params.id;
    const file = await dbClient.db.collection('files').findOne({
      _id: new ObjectId(fileId),
      userId: new ObjectId(userId)
    });

    if (!file) return res.status(404).json({ error: 'Not found' });

    await dbClient.db
      .collection('files')
      .updateOne({ _id: new ObjectId(fileId) }, { $set: { isPublic: true } });

    const updated = { ...file, isPublic: true };
    res.status(200).json({ id: file._id, ...updated });
  }

  static async putUnpublish (req, res) {
    const token = req.header('X-Token');
    const userId = await redisClient.get(`auth_${token}`);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const fileId = req.params.id;
    const file = await dbClient.db.collection('files').findOne({
      _id: new ObjectId(fileId),
      userId: new ObjectId(userId)
    });

    if (!file) return res.status(404).json({ error: 'Not found' });

    await dbClient.db
      .collection('files')
      .updateOne({ _id: new ObjectId(fileId) }, { $set: { isPublic: false } });

    const updated = { ...file, isPublic: false };
    res.status(200).json({ id: file._id, ...updated });
  }
}

export default FilesController;
