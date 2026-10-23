/* Pontec Vagas - autenticação e perfis.
   Dois provedores com a mesma interface:
   - firebase: contas reais (Authentication + Firestore), usado quando firebase-config.js está preenchido;
   - local: modo demonstração, tudo salvo no navegador (senha com PBKDF2 + sal).
   Script clássico (sem import/export) para funcionar também ao abrir via file://. */
(function () {
  "use strict";

  var supabaseConfig = window.PONTEC_SUPABASE || {};
  var supabaseReady = !!(supabaseConfig.url && (supabaseConfig.anonKey || supabaseConfig.publishableKey));
  var cfg = window.PONTEC_FIREBASE || {};
  var cfgKeys = Object.keys(cfg);
  var firebaseReady = cfgKeys.length > 0 && cfgKeys.every(function (k) {
    return cfg[k] && String(cfg[k]).indexOf("YOUR_") !== 0;
  });

  var MESSAGES = {
    "auth/email-already-in-use": "Este e-mail já possui uma conta. Use a aba Entrar.",
    "auth/invalid-credential": "E-mail ou senha incorretos.",
    "auth/invalid-email": "Informe um e-mail válido.",
    "auth/user-not-found": "E-mail ou senha incorretos.",
    "auth/wrong-password": "E-mail ou senha incorretos.",
    "auth/too-many-requests": "Muitas tentativas. Aguarde um pouco e tente de novo.",
    "auth/operation-not-allowed": "Ative o método E-mail/senha no Firebase Authentication.",
    "auth/weak-password": "A senha precisa ter pelo menos 8 caracteres.",
    "auth/network-request-failed": "Falha de conexão. Verifique a internet e tente novamente.",
    "auth/unsupported": "Recurso disponível apenas com o Firebase configurado.",
    "crypto/unavailable": "Este navegador bloqueou a criptografia local. Abra o site por HTTPS ou localhost.",
    "storage/unavailable": "Não foi possível salvar neste navegador. Verifique as permissões de armazenamento.",
    "permission-denied": "O Firestore recusou a operação. Publique as regras de firestore.rules.",
    "unavailable": "O Firebase está indisponível no momento. Tente novamente.",
    "supabase/sdk-unavailable": "Não foi possível carregar o SDK do Supabase. Verifique a conexão e recarregue a página."
  };

  function authError(code, message) {
    var e = new Error(message || code);
    e.code = code;
    return e;
  }

  function explain(error) {
    if (error && MESSAGES[error.code]) return MESSAGES[error.code];
    return "Não foi possível concluir a operação." + (error && error.message ? " (" + error.message + ")" : "");
  }

  /* ---------- Provedor local (demonstração) ---------- */
  var USERS_KEY = "pontec-users";
  var SESSION_KEY = "pontec-session";
  var JOBS_KEY = "pontec-jobs";
  var localListeners = [];

  function readUsers() {
    try {
      var v = JSON.parse(localStorage.getItem(USERS_KEY) || "{}");
      return v && typeof v === "object" && !Array.isArray(v) ? v : {};
    } catch (e) { return {}; }
  }
  function writeUsers(users) {
    try { localStorage.setItem(USERS_KEY, JSON.stringify(users)); }
    catch (e) { throw authError("storage/unavailable"); }
  }
  function readSession() {
    try { return localStorage.getItem(SESSION_KEY) || ""; } catch (e) { return ""; }
  }
  function writeSession(uid) {
    try {
      if (uid) localStorage.setItem(SESSION_KEY, uid); else localStorage.removeItem(SESSION_KEY);
    } catch (e) { throw authError("storage/unavailable"); }
  }
  function findByUid(uid) {
    var users = readUsers();
    for (var k in users) if (users[k] && users[k].uid === uid) return { key: k, rec: users[k], users: users };
    return null;
  }
  function currentLocalUser() {
    var hit = findByUid(readSession());
    return hit ? { uid: hit.rec.uid, email: hit.rec.email } : null;
  }
  function emitLocal() {
    var u = currentLocalUser();
    localListeners.forEach(function (cb) { cb(u); });
  }

  function toB64(buf) {
    var s = "";
    new Uint8Array(buf).forEach(function (b) { s += String.fromCharCode(b); });
    return btoa(s);
  }
  function fromB64(str) {
    var bin = atob(str), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function hashPassword(password, saltB64) {
    if (!(window.crypto && window.crypto.subtle)) return Promise.reject(authError("crypto/unavailable"));
    return crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"])
      .then(function (key) {
        return crypto.subtle.deriveBits(
          { name: "PBKDF2", salt: fromB64(saltB64), iterations: 120000, hash: "SHA-256" }, key, 256);
      })
      .then(toB64);
  }

  var local = {
    mode: "local",
    canReset: false,
    start: function (cb) {
      localListeners.push(cb);
      window.addEventListener("storage", function (e) {
        if (e.key === SESSION_KEY || e.key === USERS_KEY) cb(currentLocalUser());
      });
      cb(currentLocalUser());
      return Promise.resolve();
    },
    signUp: function (email, password, profile) {
      var key = email.toLowerCase();
      if (readUsers()[key]) return Promise.reject(authError("auth/email-already-in-use"));
      var salt = toB64(crypto.getRandomValues(new Uint8Array(16)));
      return hashPassword(password, salt).then(function (hash) {
        var users = readUsers();
        if (users[key]) throw authError("auth/email-already-in-use");
        var uid = "u_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        var now = new Date().toISOString();
        users[key] = {
          uid: uid, email: email, salt: salt, hash: hash,
          profile: Object.assign({}, profile, { uid: uid, email: email, createdAt: now, updatedAt: now })
        };
        writeUsers(users);
        writeSession(uid);
        emitLocal();
        return { uid: uid, email: email };
      });
    },
    signIn: function (email, password) {
      var rec = readUsers()[email.toLowerCase()];
      if (!rec) return Promise.reject(authError("auth/invalid-credential"));
      return hashPassword(password, rec.salt).then(function (hash) {
        if (hash !== rec.hash) throw authError("auth/invalid-credential");
        writeSession(rec.uid);
        emitLocal();
        return { uid: rec.uid, email: rec.email };
      });
    },
    signOut: function () {
      writeSession("");
      emitLocal();
      return Promise.resolve();
    },
    getProfile: function (uid) {
      var hit = findByUid(uid);
      return Promise.resolve(hit ? hit.rec.profile : null);
    },
    ensureProfile: function (user) { return local.getProfile(user.uid); },
    saveProfile: function (uid, changes) {
      var hit = findByUid(uid);
      if (!hit) return Promise.reject(authError("auth/user-not-found"));
      var merged = Object.assign({}, hit.rec.profile, changes, { updatedAt: new Date().toISOString() });
      hit.users[hit.key].profile = merged;
      try { writeUsers(hit.users); } catch (e) { return Promise.reject(e); }
      return Promise.resolve(merged);
    },
    listJobs: function () {
      try {
        var jobs = JSON.parse(localStorage.getItem(JOBS_KEY) || "[]");
        return Promise.resolve(Array.isArray(jobs) ? jobs : []);
      } catch (e) { return Promise.resolve([]); }
    },
    createJob: function (uid, job) {
      var hit = findByUid(uid);
      if (readSession() !== uid || !hit || hit.rec.profile.role !== "company") {
        return Promise.reject(authError("permission-denied"));
      }
      return local.listJobs().then(function (jobs) {
        var record = Object.assign({}, job, {
          id: "job_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
          companyId: uid, createdAt: new Date().toISOString()
        });
        jobs.unshift(record);
        try { localStorage.setItem(JOBS_KEY, JSON.stringify(jobs)); }
        catch (e) { throw authError("storage/unavailable"); }
        return record;
      });
    },
    deleteJob: function (uid, id) {
      var hit = findByUid(uid);
      if (readSession() !== uid || !hit || hit.rec.profile.role !== "company") {
        return Promise.reject(authError("permission-denied"));
      }
      return local.listJobs().then(function (jobs) {
        var next = jobs.filter(function (job) { return job.id !== id || job.companyId !== uid; });
        try { localStorage.setItem(JOBS_KEY, JSON.stringify(next)); }
        catch (e) { throw authError("storage/unavailable"); }
      });
    },
    resetPassword: function () { return Promise.reject(authError("auth/unsupported")); }
  };

  /* ---------- Provedor Firebase ---------- */
  var fb = null;
  var fbListeners = [];
  var registeringUid = "";

  function loadFirebase() {
    if (fb) return Promise.resolve(fb);
    var base = "https://www.gstatic.com/firebasejs/11.10.0/";
    return Promise.all([
      import(base + "firebase-app.js"),
      import(base + "firebase-auth.js"),
      import(base + "firebase-firestore.js")
    ]).then(function (m) {
      var app = m[0].initializeApp(cfg);
      fb = { auth: m[1].getAuth(app), db: m[2].getFirestore(app), A: m[1], F: m[2] };
      return fb;
    });
  }
  function fbUser(u) { return u ? { uid: u.uid, email: u.email || "", displayName: u.displayName || "" } : null; }
  function fbProfileRef(uid) { return fb.F.doc(fb.db, "profiles", uid); }

  function newProfileDoc(profile, user) {
    return Object.assign({}, profile, {
      uid: user.uid, email: user.email || "",
      createdAt: fb.F.serverTimestamp(), updatedAt: fb.F.serverTimestamp()
    });
  }

  var firebase = {
    mode: "firebase",
    canReset: true,
    start: function (cb) {
      return loadFirebase().then(function () {
        fbListeners.push(cb);
        fb.A.onAuthStateChanged(fb.auth, function (u) {
          if (u && u.uid === registeringUid) return;
          cb(fbUser(u));
        });
      });
    },
    signUp: function (email, password, profile) {
      var cred;
      return loadFirebase().then(function () {
        return fb.A.createUserWithEmailAndPassword(fb.auth, email, password);
      }).then(function (c) {
        cred = c;
        registeringUid = c.user.uid;
        return fb.A.updateProfile(c.user, { displayName: profile.nome });
      }).then(function () {
        return fb.F.setDoc(fbProfileRef(cred.user.uid), newProfileDoc(profile, cred.user));
      }).then(function () {
        registeringUid = "";
        return fbUser(cred.user);
      }).catch(function (err) {
        registeringUid = "";
        // Não deixa uma conta "sem perfil" para trás: remove e permite tentar de novo.
        if (cred && cred.user) {
          return fb.A.deleteUser(cred.user).catch(function () {}).then(function () { throw err; });
        }
        throw err;
      });
    },
    signIn: function (email, password) {
      return loadFirebase().then(function () {
        return fb.A.signInWithEmailAndPassword(fb.auth, email, password);
      }).then(function (c) { return fbUser(c.user); });
    },
    signOut: function () { return fb.A.signOut(fb.auth); },
    getProfile: function (uid) {
      return fb.F.getDoc(fbProfileRef(uid)).then(function (snap) { return snap.exists() ? snap.data() : null; });
    },
    ensureProfile: function (user) {
      return firebase.getProfile(user.uid).then(function (p) {
        if (p) return p;
        var base = {
          role: "candidate", nome: user.displayName || (user.email || "Usuário").split("@")[0],
          cidade: "", area: "", esc: "", tel: "", sobre: "", headline: "", skills: [], link: "", avatar: "", color: "#0f6b57"
        };
        return fb.F.setDoc(fbProfileRef(user.uid), newProfileDoc(base, user)).then(function () {
          return firebase.getProfile(user.uid);
        });
      });
    },
    saveProfile: function (uid, changes) {
      var payload = Object.assign({}, changes, { updatedAt: fb.F.serverTimestamp() });
      return fb.F.updateDoc(fbProfileRef(uid), payload).then(function () {
        if (fb.auth.currentUser && changes.nome && changes.nome !== fb.auth.currentUser.displayName) {
          return fb.A.updateProfile(fb.auth.currentUser, { displayName: changes.nome });
        }
      }).then(function () { return firebase.getProfile(uid); });
    },
    listJobs: function () {
      return loadFirebase().then(function () {
        return fb.F.getDocs(fb.F.collection(fb.db, "jobs"));
      }).then(function (snapshot) {
        return snapshot.docs.map(function (item) {
          return Object.assign({ id: item.id }, item.data());
        });
      });
    },
    createJob: function (uid, job) {
      return loadFirebase().then(function () {
        if (!fb.auth.currentUser || fb.auth.currentUser.uid !== uid) throw authError("permission-denied");
        return fb.F.addDoc(fb.F.collection(fb.db, "jobs"), Object.assign({}, job, {
          companyId: uid, createdAt: fb.F.serverTimestamp()
        }));
      }).then(function (ref) {
        return Object.assign({}, job, { id: ref.id, companyId: uid, createdAt: new Date().toISOString() });
      });
    },
    deleteJob: function (uid, id) {
      return loadFirebase().then(function () {
        if (!fb.auth.currentUser || fb.auth.currentUser.uid !== uid) throw authError("permission-denied");
        return fb.F.deleteDoc(fb.F.doc(fb.db, "jobs", id));
      });
    },
    resetPassword: function (email) {
      return loadFirebase().then(function () { return fb.A.sendPasswordResetEmail(fb.auth, email); });
    }
  };

  /* ---------- Provedor Supabase ---------- */
  var sbClient = null;

  function getSupabase() {
    if (sbClient) return sbClient;
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      throw authError("supabase/sdk-unavailable");
    }
    sbClient = window.supabase.createClient(
      supabaseConfig.url,
      supabaseConfig.anonKey || supabaseConfig.publishableKey
    );
    return sbClient;
  }

  function sbUser(user) {
    return user ? { uid: user.id, email: user.email || "", displayName: user.user_metadata && user.user_metadata.nome || "" } : null;
  }

  function profileFromRow(row) {
    if (!row) return null;
    return Object.assign({}, row, { uid: row.id });
  }

  function jobFromRow(row) {
    return {
      id: row.id,
      companyId: row.company_id,
      companyName: row.company_name,
      title: row.title,
      area: row.area,
      city: row.city,
      mode: row.mode,
      employmentType: row.employment_type,
      salary: row.salary,
      description: row.description,
      color: row.color || "#0f6b57",
      createdAt: row.created_at
    };
  }

  function unwrap(result) {
    if (result.error) throw result.error;
    return result.data;
  }

  var supabaseProvider = {
    mode: "supabase",
    canReset: true,
    start: function (cb) {
      var client = getSupabase();
      return client.auth.getSession().then(function (result) {
        var session = unwrap(result);
        cb(sbUser(session && session.session ? session.session.user : null));
        client.auth.onAuthStateChange(function (event, nextSession) {
          if (event !== "INITIAL_SESSION") setTimeout(function () {
            cb(sbUser(nextSession ? nextSession.user : null));
          }, 0);
        });
      });
    },
    signUp: function (email, password, profile) {
      var client = getSupabase();
      return client.auth.signUp({
        email: email,
        password: password,
        options: { data: profile }
      }).then(function (result) {
        var data = unwrap(result);
        if (!data.user) throw authError("auth/invalid-credential");
        var user = sbUser(data.user);
        if (!data.session) user.needsConfirmation = true;
        return user;
      });
    },
    signIn: function (email, password) {
      return getSupabase().auth.signInWithPassword({ email: email, password: password })
        .then(function (result) { return sbUser(unwrap(result).user); });
    },
    signOut: function () {
      return getSupabase().auth.signOut().then(unwrap);
    },
    getProfile: function (uid) {
      return getSupabase().from("profiles").select("*").eq("id", uid).maybeSingle()
        .then(function (result) { return profileFromRow(unwrap(result)); });
    },
    ensureProfile: function (user) {
      return supabaseProvider.getProfile(user.uid).then(function (profile) {
        if (!profile) throw authError("profile/missing", "O perfil não foi criado. Confira se o SQL do Supabase foi executado.");
        return profile;
      });
    },
    saveProfile: function (uid, changes) {
      var payload = Object.assign({}, changes, { updated_at: new Date().toISOString() });
      return getSupabase().from("profiles").update(payload).eq("id", uid).select("*").single()
        .then(function (result) { return profileFromRow(unwrap(result)); });
    },
    listJobs: function () {
      return getSupabase().from("jobs").select("*").eq("status", "open").order("created_at", { ascending: false })
        .then(function (result) { return unwrap(result).map(jobFromRow); });
    },
    createJob: function (uid, job) {
      var row = {
        company_id: uid,
        company_name: job.companyName,
        title: job.title,
        area: job.area,
        city: job.city,
        mode: job.mode,
        employment_type: job.employmentType,
        salary: job.salary || "A combinar",
        description: job.description,
        status: "open"
      };
      return getSupabase().from("jobs").insert(row).select("*").single()
        .then(function (result) { return jobFromRow(unwrap(result)); });
    },
    deleteJob: function (uid, id) {
      return getSupabase().from("jobs").delete().eq("id", id).eq("company_id", uid).select("id").maybeSingle()
        .then(function (result) {
          if (!unwrap(result)) throw authError("permission-denied", "A vaga não existe ou não pertence à sua empresa.");
        });
    },
    listSaved: function (uid) {
      return getSupabase().from("saved_jobs").select("job_id").eq("user_id", uid)
        .then(function (result) { return unwrap(result).map(function (row) { return row.job_id; }); });
    },
    saveJob: function (uid, jobId) {
      return getSupabase().from("saved_jobs").insert({ user_id: uid, job_id: jobId }).then(unwrap);
    },
    removeSavedJob: function (uid, jobId) {
      return getSupabase().from("saved_jobs").delete().eq("user_id", uid).eq("job_id", jobId).then(unwrap);
    },
    listApplications: function (uid) {
      return getSupabase().from("applications").select("job_id").eq("candidate_id", uid)
        .then(function (result) { return unwrap(result).map(function (row) { return row.job_id; }); });
    },
    listCompanyApplications: function (uid) {
      return getSupabase().from("applications")
        .select("id,job_id,candidate_name,candidate_email,created_at,jobs!inner(title,company_id)")
        .eq("jobs.company_id", uid)
        .order("created_at", { ascending: false })
        .then(function (result) { return unwrap(result); });
    },
    applyToJob: function (uid, jobId, profile, email) {
      var row = {
        candidate_id: uid,
        job_id: jobId,
        candidate_name: profile.nome,
        candidate_email: email
      };
      return getSupabase().from("applications").insert(row).then(unwrap);
    },
    resetPassword: function (email) {
      return getSupabase().auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname });
    }
  };

  window.PontecAuth = {
    mode: supabaseReady ? "supabase" : firebaseReady ? "firebase" : "local",
    provider: supabaseReady ? supabaseProvider : firebaseReady ? firebase : local,
    explain: explain
  };
})();
