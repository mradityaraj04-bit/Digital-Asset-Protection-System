const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase Client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const JWT_SECRET = process.env.JWT_SECRET || 'daps_super_secret_jwt_key_2024';

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.static('public'));

// ─── JWT Auth Middleware (custom JWT for existing routes) ─────────────────────
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired token.' });
  }
}

// ─── Supabase Auth Middleware (for Link Checker routes) ───────────────────────
// Validates Supabase-issued JWTs via the Supabase getUser API.
async function authenticateSupabaseToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      return res.status(403).json({ error: 'Invalid or expired token.' });
    }
    req.user = { id: user.id, email: user.email };
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Token verification failed.' });
  }
}

// ─── POST /signup ─────────────────────────────────────────────────────────────
app.post('/signup', async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required.' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  try {
    // Check if user already exists
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .single();

    if (existing) {
      return res.status(409).json({ error: 'Email already registered.' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Insert user
    const { data: user, error } = await supabase
      .from('users')
      .insert([{ name, email, password: hashedPassword }])
      .select('id, name, email, role, created_at')
      .single();

    if (error) throw error;

    // Generate JWT
    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: 'Account created successfully!',
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role }
    });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Server error during signup.' });
  }
});

// ─── POST /login ──────────────────────────────────────────────────────────────
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Login successful!',
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error during login.' });
  }
});

// ─── POST /upload ─────────────────────────────────────────────────────────────
app.post('/upload', authenticateToken, async (req, res) => {
  const { media_url, title, description } = req.body;

  if (!media_url) {
    return res.status(400).json({ error: 'Media URL is required.' });
  }

  // Basic URL validation
  try {
    new URL(media_url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL format.' });
  }

  try {
    const { data, error } = await supabase
      .from('media')
      .insert([{
        user_id: req.user.id,
        media_url,
        title: title || 'Untitled Asset',
        description: description || '',
        status: 'safe'
      }])
      .select('*')
      .single();

    if (error) throw error;

    res.status(201).json({
      message: 'Media uploaded successfully!',
      media: data
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Server error during upload.' });
  }
});

// ─── GET /media ───────────────────────────────────────────────────────────────
app.get('/media', authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('media')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({ media: data });
  } catch (err) {
    console.error('Fetch media error:', err);
    res.status(500).json({ error: 'Server error fetching media.' });
  }
});

// ─── POST /flag ───────────────────────────────────────────────────────────────
app.post('/flag', authenticateToken, async (req, res) => {
  const { media_id, reason } = req.body;

  if (!media_id || !reason) {
    return res.status(400).json({ error: 'Media ID and reason are required.' });
  }

  try {
    // Check media exists
    const { data: media, error: mediaErr } = await supabase
      .from('media')
      .select('id')
      .eq('id', media_id)
      .single();

    if (mediaErr || !media) {
      return res.status(404).json({ error: 'Media not found.' });
    }

    // Create flag record
    const { error: flagErr } = await supabase
      .from('flags')
      .insert([{ media_id, flagged_by: req.user.id, reason }]);

    if (flagErr) throw flagErr;

    // Update media status to flagged
    const { error: updateErr } = await supabase
      .from('media')
      .update({ status: 'flagged' })
      .eq('id', media_id);

    if (updateErr) throw updateErr;

    res.json({ message: 'Content flagged successfully.' });
  } catch (err) {
    console.error('Flag error:', err);
    res.status(500).json({ error: 'Server error during flagging.' });
  }
});

// ─── GET /admin/data ──────────────────────────────────────────────────────────
app.get('/admin/data', authenticateToken, async (req, res) => {
  try {
    // Fetch all media with user info
    const { data: allMedia, error: mediaErr } = await supabase
      .from('media')
      .select(`
        *,
        users:user_id (name, email)
      `)
      .order('created_at', { ascending: false });

    if (mediaErr) throw mediaErr;

    // Fetch all flags
    const { data: allFlags, error: flagErr } = await supabase
      .from('flags')
      .select(`
        *,
        media:media_id (media_url, title),
        reporter:flagged_by (name, email)
      `)
      .order('flagged_at', { ascending: false });

    if (flagErr) throw flagErr;

    // User count
    const { count: userCount } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true });

    res.json({
      totalUsers: userCount,
      totalMedia: allMedia.length,
      totalFlags: allFlags.length,
      media: allMedia,
      flags: allFlags
    });
  } catch (err) {
    console.error('Admin data error:', err);
    res.status(500).json({ error: 'Server error fetching admin data.' });
  }
});

// ─── GET /profile ─────────────────────────────────────────────────────────────
app.get('/profile', authenticateToken, async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('id, name, email, role, created_at')
      .eq('id', req.user.id)
      .single();

    if (error) throw error;

    const { count: mediaCount } = await supabase
      .from('media')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', req.user.id);

    const { count: flagCount } = await supabase
      .from('media')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', req.user.id)
      .eq('status', 'flagged');

    res.json({ user, mediaCount, flagCount });
  } catch (err) {
    console.error('Profile error:', err);
    res.status(500).json({ error: 'Server error fetching profile.' });
  }
});

// ─── Link Safety Checker ───────────────────────────────────────────────────────

/**
 * Analyzes a URL for safety and returns a structured report.
 */
function analyzeUrl(rawUrl) {
  let parsed;
  const flags = [];
  let deductions = 0;

  // 1. Basic URL parse validation
  try {
    parsed = new URL(rawUrl);
  } catch {
    return {
      status: 'Harmful',
      score: 0,
      risk_level: 'High',
      reason: 'The URL is malformed and cannot be parsed as a valid web address.',
      recommendation: 'Avoid'
    };
  }

  const hostname = parsed.hostname.toLowerCase();
  const fullUrl  = rawUrl;

  // 2. HTTPS check
  if (parsed.protocol !== 'https:') {
    flags.push('Does not use HTTPS (insecure connection)');
    deductions += 25;
  }

  // 3. Suspicious double-slashes in path
  if (parsed.pathname.includes('//')) {
    flags.push('Contains double slashes in the path (common in redirect attacks)');
    deductions += 20;
  }

  // 4. @ symbol in URL (credential embedding)
  if (fullUrl.includes('@')) {
    flags.push('Contains @ symbol — may be hiding the real destination');
    deductions += 30;
  }

  // 5. Excessively long URL
  if (fullUrl.length > 200) {
    flags.push(`Unusually long URL (${fullUrl.length} chars) — common in phishing links`);
    deductions += 15;
  }

  // 6. IP address as hostname
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    flags.push('Uses a raw IP address instead of a domain name');
    deductions += 25;
  }

  // 7. Too many subdomains (domain confusion)
  const domainParts = hostname.split('.').filter(Boolean);
  if (domainParts.length > 4) {
    flags.push('Excessive subdomain depth — may be trying to disguise the real domain');
    deductions += 15;
  }

  // 8. Suspicious TLDs
  const suspiciousTlds = ['.tk', '.ml', '.ga', '.cf', '.gq', '.xyz', '.top', '.click', '.link', '.work', '.loan'];
  const hasSuspiciousTld = suspiciousTlds.some(tld => hostname.endsWith(tld));
  if (hasSuspiciousTld) {
    flags.push('Uses a high-risk or free TLD commonly associated with phishing');
    deductions += 20;
  }

  // 9. Suspicious keywords in hostname/path
  const suspiciousKeywords = ['login', 'signin', 'verify', 'secure', 'account', 'update', 'confirm', 'banking', 'paypal', 'apple', 'amazon', 'microsoft', 'google', 'facebook'];
  const pathAndHost = (hostname + parsed.pathname).toLowerCase();
  const foundKeywords = suspiciousKeywords.filter(k => pathAndHost.includes(k));
  if (foundKeywords.length > 0) {
    flags.push(`Contains suspicious keywords: "${foundKeywords.join('", "')}"`);
    deductions += Math.min(foundKeywords.length * 10, 25);
  }

  // 10. Punycode / international lookalike domain
  if (hostname.startsWith('xn--')) {
    flags.push('Uses a Punycode (international) domain — check for lookalike characters');
    deductions += 20;
  }

  // 11. Excessive query parameters
  const paramCount = [...parsed.searchParams].length;
  if (paramCount > 6) {
    flags.push(`Contains ${paramCount} query parameters — unusually high for a normal URL`);
    deductions += 10;
  }

  // 12. Known shortener domains (can hide destination)
  const shorteners = ['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'short.link', 'is.gd', 'cli.gs', 'tiny.cc'];
  if (shorteners.includes(hostname)) {
    flags.push('Uses a URL shortener — the real destination is hidden');
    deductions += 15;
  }

  const score = Math.max(0, 100 - deductions);

  let status, risk_level, recommendation;
  if (score >= 75) {
    status = 'Safe';
    risk_level = 'Low';
    recommendation = 'Safe to use';
  } else if (score >= 45) {
    status = 'Suspicious';
    risk_level = 'Medium';
    recommendation = 'Be careful';
  } else {
    status = 'Harmful';
    risk_level = 'High';
    recommendation = 'Avoid';
  }

  const reason = flags.length > 0
    ? flags.join('. ') + '.'
    : 'No suspicious patterns detected. The URL appears legitimate.';

  return { status, score, risk_level, reason, recommendation };
}

// ─── POST /check-link ──────────────────────────────────────────────────────────
app.post('/check-link', authenticateSupabaseToken, async (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== 'string' || url.trim().length === 0) {
    return res.status(400).json({ error: 'A valid URL is required.' });
  }

  const trimmedUrl = url.trim();

  try {
    const result = analyzeUrl(trimmedUrl);

    // Persist to Supabase
    const { error: dbErr } = await supabase
      .from('link_checks')
      .insert([{
        user_id: req.user.id,
        url: trimmedUrl,
        status: result.status,
        score: result.score,
        risk_level: result.risk_level,
        reason: result.reason,
        recommendation: result.recommendation
      }]);

    if (dbErr) {
      console.error('DB insert error (non-fatal):', dbErr.message);
    }

    res.json({ url: trimmedUrl, ...result });
  } catch (err) {
    console.error('Link check error:', err);
    res.status(500).json({ error: 'Server error while checking the link.' });
  }
});

// ─── GET /link-history ────────────────────────────────────────────────────────
app.get('/link-history', authenticateSupabaseToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('link_checks')
      .select('*')
      .eq('user_id', req.user.id)
      .order('checked_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    res.json({ history: data });
  } catch (err) {
    console.error('Link history error:', err);
    res.status(500).json({ error: 'Server error fetching history.' });
  }
});

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`🛡️  DAPS Server running on http://localhost:${PORT}`);
});
