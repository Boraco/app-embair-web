const http = require('http');

const data = JSON.stringify({
    platform: "whatsapp",
    product_name: "Cable HDMI",
    question: "¿Sirve para 4K?",
    product_info: "Soporta 4K, 60Hz, mallado, puntas doradas",
    price: 10,
    stock: 50
});

const options = {
    hostname: '127.0.0.1',
    port: 8000,
    path: '/api/ai/analyze',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
    }
};

const req = http.request(options, (res) => {
    console.log(`STATUS: ${res.statusCode}`);
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
        console.log(`BODY: ${chunk}`);
    });
});

req.on('error', (e) => {
    console.error(`problem with request: ${e.message}`);
});

req.write(data);
req.end();
