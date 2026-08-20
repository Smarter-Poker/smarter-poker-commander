const fs = require('fs');
let code = fs.readFileSync('pages/commander/login.js', 'utf8');

// SP Button
code = code.replace("top: '26.3%',", "top: '26.3%',"); 
code = code.replace("height: '7.5%',", "height: '6.2%',");

// Google
code = code.replace("top: '39.3%',", "top: '38.0%',"); 
code = code.replace("height: '4.7%',", "height: '4.5%',");

// Email
code = code.replace("top: '52%',", "top: '50.2%',"); 
code = code.replace("height: '4.7%',", "height: '4.3%',");

// Password
code = code.replace("top: '60.5%',", "top: '58.7%',"); 
// height already replaced or shared? wait, I will replace all instances of '60.5%' to '58.7%'

code = code.replace(/top: '60\.5%',/g, "top: '58.7%',");
code = code.replace(/top: '66\.5%',/g, "top: '64.5%',"); // Remember me
code = code.replace(/top: '66\.2%',/g, "top: '64.5%',"); // Forgot password link

// Sign In
code = code.replace("top: '70%',", "top: '68.0%',");
code = code.replace("height: '5%',", "height: '5.4%',");

// Sign Up
code = code.replace("top: '80.7%',", "top: '77.9%',");

fs.writeFileSync('pages/commander/login.js', code);
console.log('Coordinates adjusted');
