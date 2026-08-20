const fs = require('fs');
let code = fs.readFileSync('pages/commander/login.js', 'utf8');

const returnStart = code.indexOf('return (');
if (returnStart === -1) {
  console.error("Could not find return statement");
  process.exit(1);
}

const beforeReturn = code.substring(0, returnStart);

const newReturn = `return (
    <div className="min-h-screen bg-[#02050A] flex items-center justify-center relative overflow-hidden font-rajdhani">
      <SEOHead
        title="Club Commander - Sign In"
        description="Club Commander Poker Room Management Tool."
        noindex={true}
      />

      <div 
        className="relative w-full max-w-[809px] mx-auto shadow-2xl" 
        style={{ aspectRatio: '809/968' }}
      >
        {/* Exact User Provided Background Image */}
        <img 
          src="/images/commander/login-bg-new.jpg" 
          className="absolute inset-0 w-full h-full object-contain pointer-events-none" 
          alt="Login Background Mockup" 
        />

        {/* 
          OVERLAYS 
          All elements below are absolutely positioned to sit exactly 
          on top of the drawn elements in the image.
        */}

        {/* 1. SSO Bridge Button overlay */}
        {ssoEmail && (
          <button
            type="button"
            onClick={handleSSOContinue}
            disabled={ssoLoading || loading}
            style={{
              position: 'absolute',
              top: '26.3%',
              left: '25.7%',
              width: '48.6%',
              height: '7.5%',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              zIndex: 10,
              display: 'flex',
              alignItems: 'center',
              paddingLeft: '15%',
              color: 'white',
              fontSize: '14px',
              fontWeight: '600'
            }}
            title="Continue with SSO"
          >
            {ssoLoading ? 'Signing In...' : ssoEmail}
          </button>
        )}

        {/* 2. Google OAuth Button overlay */}
        <button
          type="button"
          onClick={() => handleOAuthSignIn('google')}
          disabled={loading}
          style={{
            position: 'absolute',
            top: '39.3%',
            left: '25.7%',
            width: '48.6%',
            height: '4.7%',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            zIndex: 10
          }}
          title="Continue With Google"
        />

        <form onSubmit={handleSubmit} style={{ display: 'contents' }}>
          
          {/* 3. Email Input overlay */}
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{
              position: 'absolute',
              top: '52%',
              left: '30%',
              width: '43.3%',
              height: '4.7%',
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'white',
              fontSize: '16px',
              zIndex: 10
            }}
          />

          {/* 4. Password Input overlay */}
          <input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{
              position: 'absolute',
              top: '60.5%',
              left: '30%',
              width: '38%', // Leave room for eye icon
              height: '4.7%',
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'white',
              fontSize: '16px',
              zIndex: 10
            }}
          />

          {/* 5. Eye Icon Toggle overlay */}
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            style={{
              position: 'absolute',
              top: '60.5%',
              left: '69%',
              width: '5%',
              height: '4.7%',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              zIndex: 11
            }}
            title="Toggle Password Visibility"
          />

          {/* 6. Remember Me Checkbox overlay */}
          <input
            type="checkbox"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
            style={{
              position: 'absolute',
              top: '66.5%',
              left: '25.7%',
              width: '2%',
              height: '1.7%',
              cursor: 'pointer',
              opacity: 0.01, /* Almost invisible, but clickable */
              zIndex: 10
            }}
            title="Remember Me"
          />
          {/* Visual mock of checkbox state to cover the drawn one if checked */}
          {rememberMe && (
            <div style={{
              position: 'absolute',
              top: '66.5%',
              left: '25.7%',
              width: '1.8%',
              height: '1.5%',
              background: '#0070f3',
              borderRadius: '2px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
              zIndex: 9
            }}>
              <Check className="w-3 h-3 text-white" strokeWidth={3} />
            </div>
          )}

          {/* 7. Forgot Password Link overlay */}
          <a 
            href="#"
            style={{
              position: 'absolute',
              top: '66.2%',
              left: '60%',
              width: '14%',
              height: '2%',
              background: 'transparent',
              cursor: 'pointer',
              zIndex: 10
            }}
            title="Forgot Password"
          />

          {/* 8. Sign In Button overlay */}
          <button
            type="submit"
            disabled={loading}
            style={{
              position: 'absolute',
              top: '70%',
              left: '25.7%',
              width: '48.6%',
              height: '5%',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              zIndex: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white'
            }}
            title="Sign In"
          >
            {loading && <Loader2 className="w-5 h-5 animate-spin" />}
          </button>
        </form>

        {/* Error Message Display Overlay */}
        {error && (
          <div style={{
            position: 'absolute',
            top: '76%',
            left: '25.7%',
            width: '48.6%',
            textAlign: 'center',
            color: '#F02849',
            backgroundColor: 'rgba(0,0,0,0.7)',
            padding: '4px',
            borderRadius: '4px',
            fontSize: '14px',
            zIndex: 10
          }}>
            {error}
          </div>
        )}

        {/* 9. Sign Up Button overlay */}
        <Link
          href="/commander/register"
          style={{
            position: 'absolute',
            top: '80.7%',
            left: '25.7%',
            width: '48.6%',
            height: '4.7%',
            background: 'transparent',
            cursor: 'pointer',
            zIndex: 10
          }}
          title="Sign Up"
        />

      </div>
    </div>
  );
}`;

fs.writeFileSync('pages/commander/login.js', beforeReturn + newReturn);
console.log('Successfully patched login.js to use the exact image!');
