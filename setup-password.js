/**
 * setup-password.js
 * Chạy lệnh: node setup-password.js
 * Dùng để tạo bcrypt hash cho mật khẩu admin.
 * Sao chép kết quả vào file .env với tên biến ADMIN_PASSWORD_HASH.
 */

const bcrypt = require('bcryptjs');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question('Nhập mật khẩu admin mới: ', async (password) => {
  if (!password || password.trim().length < 6) {
    console.error('\nLỗi: Mật khẩu phải có ít nhất 6 ký tự.');
    rl.close();
    return;
  }

  console.log('\nĐang tạo hash (có thể mất vài giây)...');
  const hash = await bcrypt.hash(password.trim(), 12);

  console.log('\n✅ Hoàn tất! Sao chép dòng sau vào file .env:\n');
  console.log(`ADMIN_PASSWORD_HASH=${hash}`);
  console.log('\nLưu ý: Không bao giờ chia sẻ file .env hoặc hash này với người khác.');
  rl.close();
});
