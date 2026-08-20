const fs = require('fs');
let code = fs.readFileSync('pages/commander/login.js', 'utf8');

code = code.replace("import Image from 'next/image';\n", "");

fs.writeFileSync('pages/commander/login.js', code);
console.log('Removed unused Image import');
