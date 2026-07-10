'use strict';

require('dotenv').config();
const { MongoClient } = require('mongodb');

// URI lấy từ .env
// Lưu ý: Người dùng phải thay thế <db_password> bằng mật khẩu thật trong .env
const uri = process.env.MONGODB_URI;

if (!uri) {
  console.error('[FATAL] MONGODB_URI chưa được định nghĩa trong file .env');
  process.exit(1);
}

const client = new MongoClient(uri);

let db = null;
let classesCollection = null;
let settingsCollection = null;

async function connectDB() {
  if (db) return;
  try {
    await client.connect();
    db = client.db('classPointsDB'); // Tên database
    classesCollection = db.collection('classes');
    settingsCollection = db.collection('settings');
    console.log('✅ Đã kết nối MongoDB thành công!');
    await seedDataIfNeeded();
  } catch (error) {
    console.error('❌ Lỗi kết nối MongoDB:', error);
    process.exit(1);
  }
}

async function seedDataIfNeeded() {
  const count = await classesCollection.countDocuments();
  if (count === 0) {
    console.log('Đang tạo dữ liệu mẫu...');
    await settingsCollection.updateOne(
      { _id: 'global' },
      { $set: { title: '🍊COLLECTED' } },
      { upsert: true }
    );

    const defaultClasses = [
      {
        id: 'c1',
        name: 'Lớp 10A1',
        created_at: Date.now(),
        order: 0,
        students: [
          { id: 's1', name: 'Nguyễn Văn A', points: 5, created_at: Date.now() },
          { id: 's2', name: 'Trần Thị B', points: 12, created_at: Date.now() },
          { id: 's3', name: 'Lê Văn C', points: 8, created_at: Date.now() },
          { id: 's4', name: 'Phạm Thị D', points: 2, created_at: Date.now() },
          { id: 's5', name: 'Hoàng Văn E', points: 25, created_at: Date.now() }
        ]
      },
      {
        id: 'c2',
        name: 'Lớp 10A2',
        created_at: Date.now(),
        order: 1,
        students: [
          { id: 's6', name: 'Vũ Thị F', points: 10, created_at: Date.now() },
          { id: 's7', name: 'Đặng Văn G', points: 4, created_at: Date.now() },
          { id: 's8', name: 'Bùi Thị H', points: 18, created_at: Date.now() }
        ]
      }
    ];

    await classesCollection.insertMany(defaultClasses);
    console.log('Tạo dữ liệu mẫu thành công!');
  }
}

module.exports = {
  connectDB,
  getClassesCollection: () => classesCollection,
  getSettingsCollection: () => settingsCollection
};
