import { v4 as uuidv4 } from 'uuid';
import { promises as fs } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { ObjectId } from 'mongodb';
import dbClient from '../utils/db';
import redisClient from '../utils/redis';

const folderPath = process.env.FOLDER_PATH || '/tmp/files_manager';

class FilesController {
  static async postUpload(req, res) {
    const token = req.header('X-Token');
    const key = `auth_${token}`;
    const userId = await redisClient.get(key);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { name, type, parentId = 0, isPublic = false, data } = req.body;

    if (!name) return res.status(400).json({ error: 'Missing name' });
    if (!type || !['folder', 'file', 'image'].includes(type)) {
      return res.status(400).json({ error: 'Missing type' });
    }

    if (type !== 'folder' && !data) return res.status(400).json({ error: 'Missing data' });

    if (parentId !== 0) {
      const parent = await dbClient.db.collection('files').findOne({ _id: ObjectId(parentId) });
      if (!parent) return res.status(400).json({ error: 'Parent not found' });
      if (parent.type !== 'folder') return res.status(400).json({ error: 'Parent is not a folder' });
    }

    const fileDocument = {
      userId: ObjectId(userId),
      name,
      type,
      isPublic,
      parentId: parentId === 0 ? 0 : ObjectId(parentId),
    };

    if (type === 'folder') {
      const result = await dbClient.db.collection('files').insertOne(fileDocument);
      return res.status(201).json({
        id: result.insertedId,
        ...fileDocument,
      });
    }

    await mkdir(folderPath, { recursive: true });
    const fileName = uuidv4();
    const localPath = path.join(folderPath, fileName);
    const buffer = Buffer.from(data, 'base64');
    await writeFile(localPath, buffer);

    fileDocument.localPath = localPath;
    const result = await dbClient.db.collection('files').insertOne(fileDocument);

    res.status(201).json({
      id: result.insertedId,
      ...fileDocument,
    });
  }
}

export default FilesController;
