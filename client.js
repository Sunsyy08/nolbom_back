const { io } = require("socket.io-client");

const socket = io("http://localhost:3000");

socket.on("connect", () => {
  console.log("✅ WebSocket 연결됨");
});

socket.on("location_update", (data) => {
  console.log("📡 [실시간 수신] 위치 업데이트:", data);
});

socket.on("disconnect", () => {
  console.log("❌ 연결 끊김");
});

socket.on("connect_error", (err) => {
  console.error("❌ 연결 오류:", err.message);
});
