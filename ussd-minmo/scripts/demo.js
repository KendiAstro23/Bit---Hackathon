const BASE_URL = process.env.DEMO_URL || 'http://localhost:3000/ussd';
const PHONE = process.env.DEMO_PHONE || '+254700000999';
const SESSION = `demo-${Date.now()}`;

async function send(text) {
  const body = new URLSearchParams({
    sessionId: SESSION,
    serviceCode: process.env.USSD_SERVICE_CODE || '*384#',
    phoneNumber: PHONE,
    text
  });

  const response = await fetch(BASE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  });

  const output = await response.text();
  console.log(`\n> text="${text}"\n${output}`);
}

try {
  await send('');
  await send('1');
  await send('1*Amina Doe');
  await send('1*Amina Doe*1');
  await send('1*Amina Doe*1*1');
  await send('1*Amina Doe*1*1*25000');
  await send('1*Amina Doe*1*1*25000*1');
} catch (error) {
  console.error(`Demo failed. Start the server first with "npm run dev".\n${error.message}`);
  process.exit(1);
}
