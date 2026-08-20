const fs = require('fs');
let code = fs.readFileSync('pages/commander/login.js', 'utf8');

code = code.replace(
  "import { Loader2, Eye, EyeOff, ArrowRight, Mail, Lock, ChevronRight, UserPlus, ShieldCheck, AlertCircle, Check } from 'lucide-react';",
  "import { Loader2, Check } from 'lucide-react';"
);

fs.writeFileSync('pages/commander/login.js', code);
