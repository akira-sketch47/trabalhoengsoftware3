/* Pontec Vagas - interface: vagas, cadastro/login e perfil personalizável. */
(function () {
  "use strict";

  var JOBS = window.PONTEC_JOBS || [];
  var Auth = window.PontecAuth;
  var provider = Auth.provider;

  var $ = function (id) { return document.getElementById(id); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var state = { user: null, profile: null, ready: false, area: "", tab: "todas", saved: [], applied: [], companyJobs: [], companyIntent: false };
  var draft = { avatar: "", color: "", skills: [] };
  var readyResolve;
  var readyPromise = new Promise(function (r) { readyResolve = r; });
  var sessionSeq = 0;

  var COLORS = [
    ["#0f6b57", "Verde"], ["#2f6fd6", "Azul"], ["#7b2fd6", "Roxo"], ["#d62f4f", "Vermelho"],
    ["#c2570c", "Laranja"], ["#16794a", "Esmeralda"], ["#0b78a8", "Ciano"], ["#ba5c85", "Rosa"],
    ["#455ca8", "Índigo"], ["#13201c", "Grafite"]
  ];

  /* ---------- Utilidades ---------- */
  function toast(msg, kind) {
    var t = document.createElement("div");
    t.className = "toast" + (kind === "error" ? " is-error" : "");
    t.textContent = msg;
    $("toasts").appendChild(t);
    setTimeout(function () {
      t.classList.add("out");
      setTimeout(function () { t.remove(); }, 320);
    }, kind === "error" ? 6000 : 3800);
  }

  function initials(name) {
    var parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    var first = parts[0][0] || "";
    var last = parts.length > 1 ? parts[parts.length - 1][0] : "";
    return (first + last).toUpperCase();
  }

  function defaultColor(name) {
    var h = 0, s = String(name || "");
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return COLORS[h % COLORS.length][0];
  }

  function validColor(c) {
    return COLORS.some(function (x) { return x[0] === c; }) ? c : "";
  }

  function paintAvatar(node, data) {
    var color = validColor(data.color) || defaultColor(data.nome);
    node.style.setProperty("--pc", color);
    if (typeof data.avatar === "string" && data.avatar.indexOf("data:image/") === 0) {
      node.style.backgroundImage = 'url("' + data.avatar + '")';
      node.textContent = "";
    } else {
      node.style.backgroundImage = "none";
      node.textContent = initials(data.nome);
    }
  }

  function digits(v) { return String(v || "").replace(/\D/g, ""); }

  function maskTel(v) {
    var d = digits(v).slice(0, 11);
    if (d.length <= 2) return d ? "(" + d : "";
    if (d.length <= 6) return "(" + d.slice(0, 2) + ") " + d.slice(2);
    if (d.length <= 10) return "(" + d.slice(0, 2) + ") " + d.slice(2, 6) + "-" + d.slice(6);
    return "(" + d.slice(0, 2) + ") " + d.slice(2, 7) + "-" + d.slice(7);
  }

  function maskCnpj(v) {
    var d = digits(v).slice(0, 14), out = d;
    if (d.length > 2) out = d.slice(0, 2) + "." + d.slice(2);
    if (d.length > 5) out = d.slice(0, 2) + "." + d.slice(2, 5) + "." + d.slice(5);
    if (d.length > 8) out = d.slice(0, 2) + "." + d.slice(2, 5) + "." + d.slice(5, 8) + "/" + d.slice(8);
    if (d.length > 12) out = d.slice(0, 2) + "." + d.slice(2, 5) + "." + d.slice(5, 8) + "/" + d.slice(8, 12) + "-" + d.slice(12);
    return out;
  }

  function validCnpj(v) {
    return digits(v).length === 14;
  }

  function normalizeUrl(v) {
    v = String(v || "").trim();
    if (!v) return "";
    if (!/^https?:\/\//i.test(v)) v = "https://" + v;
    try {
      var u = new URL(v);
      if ((u.protocol !== "http:" && u.protocol !== "https:") || u.hostname.indexOf(".") < 0) return null;
      return u.href;
    } catch (e) { return null; }
  }

  function fieldError(f) {
    var raw = f.value;
    var v = f.type === "password" ? raw : raw.trim();
    if (f.required && !v) return "Preencha este campo.";
    if (!v) return "";
    switch (f.dataset.v) {
      case "email": if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return "Informe um e-mail válido."; break;
      case "password": if (v.length < 8) return "Use ao menos 8 caracteres."; break;
      case "cnpj": if (!validCnpj(v)) return "Digite os 14 números do CNPJ, mesmo que seja fictício."; break;
      case "tel": if (digits(v).length < 10) return "Informe DDD e número."; break;
      case "url": if (normalizeUrl(v) === null) return "Informe um endereço válido, como linkedin.com/in/seu-nome."; break;
    }
    return "";
  }

  function validateForm(form) {
    var ok = true;
    $$("input:not([data-skip]),select,textarea", form).forEach(function (f) {
      var msg = fieldError(f);
      var out = f.closest(".f") && f.closest(".f").querySelector(".err");
      if (out) out.textContent = msg;
      f.classList.toggle("bad", !!msg);
      f.setAttribute("aria-invalid", msg ? "true" : "false");
      if (msg) ok = false;
    });
    var bad = form.querySelector(".bad");
    if (bad) bad.focus();
    return ok;
  }

  function clearErrors(form) {
    $$(".err", form).forEach(function (e) { e.textContent = ""; });
    $$(".bad", form).forEach(function (f) { f.classList.remove("bad"); f.removeAttribute("aria-invalid"); });
  }

  function setBusy(form, busy, label) {
    $$("button[type=submit]", form).forEach(function (b) {
      if (busy) { b.dataset.label = b.textContent; b.textContent = label || "Aguarde…"; }
      else if (b.dataset.label) { b.textContent = b.dataset.label; }
      b.disabled = busy;
    });
  }

  /* ---------- Listas por usuário (salvas e candidaturas) ---------- */
  function listKey(name) { return "pontec-" + name + ":" + (state.user ? state.user.uid : "guest"); }
  function readList(name) {
    try {
      var v = JSON.parse(localStorage.getItem(listKey(name)) || "[]");
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }
  function writeList(name, value) {
    try { localStorage.setItem(listKey(name), JSON.stringify(value)); return true; }
    catch (e) { toast("Não foi possível salvar neste navegador. Verifique as permissões de armazenamento.", "error"); return false; }
  }
  function loadLists() {
    if (Auth.mode !== "supabase") {
      state.saved = readList("salvas");
      state.applied = readList("candidaturas");
      return Promise.resolve();
    }
    if (!state.user) {
      state.saved = [];
      state.applied = [];
      return Promise.resolve();
    }
    var savedRequest = provider.listSaved(state.user.uid);
    var appliedRequest = state.profile && state.profile.role === "candidate"
      ? provider.listApplications(state.user.uid) : Promise.resolve([]);
    return Promise.all([savedRequest, appliedRequest]).then(function (lists) {
      state.saved = lists[0];
      state.applied = lists[1];
    }).catch(function (err) {
      state.saved = [];
      state.applied = [];
      toast(Auth.explain(err), "error");
    });
  }

  /* ---------- Vagas ---------- */
  function refreshSearchOptions() {
    var citySelect = $("cidade"), selectedCity = citySelect.value, cities = [];
    JOBS.forEach(function (job) {
      if (job.m !== "Remoto" && cities.indexOf(job.l) < 0) cities.push(job.l);
    });
    cities.sort();
    while (citySelect.options.length > 1) citySelect.remove(1);
    cities.forEach(function (city) {
      var option = document.createElement("option");
      option.value = city;
      option.textContent = city;
      citySelect.appendChild(option);
    });
    citySelect.value = cities.indexOf(selectedCity) > -1 ? selectedCity : "";

    var areas = ["Todas"].concat(JOBS.map(function (job) { return job.a; }).filter(function (value, index, all) {
      return all.indexOf(value) === index;
    }));
    if (state.area && areas.indexOf(state.area) < 0) state.area = "";
    $("chips").innerHTML = "";
    areas.forEach(function (area, index) {
      var button = document.createElement("button");
      button.className = "chip";
      button.type = "button";
      button.textContent = area;
      button.setAttribute("aria-pressed", (index ? area === state.area : !state.area) ? "true" : "false");
      button.addEventListener("click", function () {
        state.area = index ? area : "";
        $$(".chip", $("chips")).forEach(function (chip) {
          chip.setAttribute("aria-pressed", chip === button ? "true" : "false");
        });
        renderJobs();
      });
      $("chips").appendChild(button);
    });

    var companies = {};
    JOBS.forEach(function (job) { companies[job.c] = true; });
    $("s-vagas").textContent = JOBS.length;
    $("s-empresas").textContent = Object.keys(companies).length;
    $("s-cidades").textContent = cities.length;
  }

  function setupSearch() {
    refreshSearchOptions();
    $("buscar").addEventListener("click", renderJobs);
    $("q").addEventListener("input", renderJobs);
    $("cidade").addEventListener("change", renderJobs);
    $("modo").addEventListener("change", renderJobs);
    $$("[data-tab]").forEach(function (b) {
      b.addEventListener("click", function () {
        state.tab = b.dataset.tab;
        $$("[data-tab]").forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
        renderJobs();
      });
    });
  }

  function normalizePublishedJob(job) {
    return {
      id: job.id, companyId: job.companyId || "", t: job.title || "", c: job.companyName || "",
      cor: validColor(job.color) || defaultColor(job.companyName), a: job.area || "Outros",
      l: job.city || "Remoto", m: job.mode || "Presencial", tipo: job.employmentType || "CLT",
      s: job.salary || "A combinar", d: job.description || ""
    };
  }

  function loadPublishedJobs() {
    return provider.listJobs().then(function (jobs) {
      var known = {};
      JOBS.forEach(function (job) { known[job.id] = true; });
      jobs.forEach(function (job) {
        var listing = normalizePublishedJob(job);
        if (listing.id && !known[listing.id]) {
          known[listing.id] = true;
          JOBS.push(listing);
        }
      });
      state.companyJobs = jobs;
      refreshSearchOptions();
      renderJobs();
      renderCompanyJobs();
    }).catch(function (err) {
      if (Auth.mode === "firebase" || Auth.mode === "supabase") toast(Auth.explain(err), "error");
    });
  }

  function filteredJobs() {
    var q = $("q").value.toLowerCase().trim(), ci = $("cidade").value, mo = $("modo").value;
    return JOBS.filter(function (j) {
      return (!q || (j.t + " " + j.c).toLowerCase().indexOf(q) > -1) &&
        (!ci || j.l === ci) && (!mo || j.m === mo) && (!state.area || j.a === state.area) &&
        (state.tab !== "salvas" || state.saved.indexOf(j.id) > -1) &&
        (state.tab !== "candidaturas" || state.applied.indexOf(j.id) > -1);
    });
  }

  function emptyMessage() {
    if (state.tab === "salvas") return "Você ainda não salvou nenhuma vaga. Toque no coração de uma vaga para guardá-la aqui.";
    if (state.tab === "candidaturas") return "Você ainda não se candidatou a nenhuma vaga.";
    return "Nenhuma vaga encontrada. Tente outro cargo, cidade ou modalidade.";
  }

  function renderJobs() {
    var list = filteredJobs();
    $("n-salvas").textContent = state.saved.length;
    $("n-cand").textContent = state.applied.length;
    $("count").textContent = list.length + (list.length === 1 ? " vaga encontrada" : " vagas encontradas");
    if (!list.length) {
      $("lista").innerHTML = '<div class="empty"><p>' + esc(emptyMessage()) + "</p>" +
        (state.tab !== "todas" ? '<button class="btn ghost sm" type="button" data-tab-reset>Ver todas as vagas</button>' : "") + "</div>";
      return;
    }
    $("lista").innerHTML = list.map(function (j) {
      var saved = state.saved.indexOf(j.id) > -1, applied = state.applied.indexOf(j.id) > -1;
      var canPersist = Auth.mode !== "supabase" || state.companyJobs.some(function (job) { return job.id === j.id; });
      return '<article class="job"><div class="co-logo" style="background:' + esc(j.cor) + '" aria-hidden="true">' + esc(j.c[0]) + "</div>" +
        '<div><h3>' + esc(j.t) + '</h3><p class="job-co">' + esc(j.c) + " – " + esc(j.l) + '</p><div class="tags"><span class="tag">' +
        esc(j.m) + '</span><span class="tag">' + esc(j.tipo) + '</span><span class="tag">' + esc(j.a) + "</span>" +
        (applied ? '<span class="tag ok">Candidatura enviada</span>' : "") + "</div></div>" +
        '<div class="job-side"><span class="sal">' + esc(j.s) + '</span><div class="job-actions">' +
        '<button class="icon-btn fav" type="button" data-fav="' + j.id + '" aria-pressed="' + saved + '" aria-label="' + (saved ? "Remover " : "Salvar ") + esc(j.t) + (saved ? " das vagas salvas" : " nas vagas salvas") + '"' + (canPersist ? "" : ' disabled title="Vaga de exemplo; interações reais estão disponíveis para vagas publicadas"') + '>' +
        '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-9.2-9.2C1.6 8 3.7 5 6.9 5c1.9 0 3.5 1 5.1 3 1.6-2 3.2-3 5.1-3 3.2 0 5.3 3 4.1 6.3-1.7 4.6-9.2 9.2-9.2 9.2z"/></svg></button>' +
        '<button class="btn sm" type="button" data-view="' + j.id + '">Ver vaga</button></div></div></article>';
    }).join("");
  }

  function jobById(id) { return JOBS.filter(function (j) { return j.id === id; })[0]; }

  var openJob = null;
  function showJob(j) {
    openJob = j;
    $("jd-logo").style.background = j.cor;
    $("jd-logo").textContent = j.c[0];
    $("jd-t").textContent = j.t;
    $("jd-c").textContent = j.c + " – " + j.l;
    $("jd-tags").innerHTML = '<span class="tag">' + esc(j.m) + '</span><span class="tag">' + esc(j.tipo) + '</span><span class="tag">' + esc(j.a) + "</span>";
    $("jd-d").textContent = j.d;
    $("jd-s").textContent = "Salário: " + j.s;
    refreshApplyButton();
    $("job-dlg").showModal();
  }

  function refreshApplyButton() {
    if (!openJob) return;
    var btn = $("jd-apply"), note = $("jd-note");
    var applied = state.applied.indexOf(openJob.id) > -1;
    note.textContent = "";
    btn.disabled = false;
    btn.textContent = "Candidatar-se";
    if (applied) {
      btn.textContent = "Candidatura enviada";
      btn.disabled = true;
    } else if (Auth.mode === "supabase" && !state.companyJobs.some(function (job) { return job.id === openJob.id; })) {
      btn.disabled = true;
      note.textContent = "Vaga de exemplo. Para se candidatar, escolha uma vaga publicada por uma empresa.";
    } else if (!state.user) {
      btn.textContent = "Entrar para se candidatar";
    } else if (state.profile && state.profile.role === "company") {
      btn.disabled = true;
      note.textContent = "Contas de empresa não podem se candidatar a vagas.";
    } else {
      note.textContent = Auth.mode === "supabase"
        ? "Sua candidatura será compartilhada com a empresa responsável pela vaga."
        : "Projeto acadêmico: a candidatura é registrada neste navegador e nenhum dado é enviado a empresas.";
    }
  }

  function applyToJob() {
    if (!openJob) return;
    if (!state.user) {
      $("job-dlg").close();
      openAuth("login", "Entre ou crie uma conta para se candidatar.");
      return;
    }
    if (state.profile && state.profile.role === "company") return;
    if (state.applied.indexOf(openJob.id) > -1) return;
    if (Auth.mode === "supabase") {
      provider.applyToJob(state.user.uid, openJob.id, state.profile, state.user.email)
        .then(function () {
          state.applied = state.applied.concat([openJob.id]);
          refreshApplyButton();
          renderJobs();
          toast("Candidatura enviada para " + openJob.t + ".");
        })
        .catch(function (err) { toast(Auth.explain(err), "error"); });
      return;
    }
    var next = state.applied.concat([openJob.id]);
    if (writeList("candidaturas", next)) {
      state.applied = next;
      refreshApplyButton();
      renderJobs();
      toast("Candidatura registrada para " + openJob.t + ".");
    }
  }

  function toggleSaved(id) {
    if (Auth.mode === "supabase") {
      if (!state.user) {
        openAuth("login", "Entre para salvar vagas na sua conta.");
        return;
      }
      if (!state.companyJobs.some(function (job) { return job.id === id; })) return;
      var isSaved = state.saved.indexOf(id) > -1;
      var request = isSaved ? provider.removeSavedJob(state.user.uid, id) : provider.saveJob(state.user.uid, id);
      request.then(function () {
        state.saved = isSaved ? state.saved.filter(function (savedId) { return savedId !== id; }) : state.saved.concat([id]);
        renderJobs();
      }).catch(function (err) { toast(Auth.explain(err), "error"); });
      return;
    }
    var next = state.saved.slice(), pos = next.indexOf(id);
    if (pos > -1) next.splice(pos, 1); else next.push(id);
    if (writeList("salvas", next)) { state.saved = next; renderJobs(); }
  }

  /* ---------- Tema ---------- */
  function currentTheme() {
    return document.documentElement.dataset.theme ||
      (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  }
  function refreshThemeButton() {
    var dark = currentTheme() === "dark";
    $("theme").setAttribute("aria-label", dark ? "Ativar tema claro" : "Ativar tema escuro");
  }
  $("theme").addEventListener("click", function () {
    var next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("pontec-tema", next); } catch (e) { /* tema vale só nesta visita */ }
    refreshThemeButton();
  });

  /* ---------- Diálogo de conta ---------- */
  var AUTH_TITLES = {
    login: "Entrar na sua conta",
    candidate: "Crie seu perfil de candidato",
    company: "Cadastre sua empresa"
  };

  function setAuthTab(tab) {
    ["login", "candidate", "company"].forEach(function (k) {
      var on = k === tab;
      $("f-" + k).hidden = !on;
      $("tab-" + k).setAttribute("aria-selected", on ? "true" : "false");
      $("tab-" + k).tabIndex = on ? 0 : -1;
    });
    $("auth-title").textContent = AUTH_TITLES[tab];
    $("auth-error").hidden = true;
  }

  function openAuth(tab, note) {
    tab = tab || "login";
    setAuthTab(tab);
    $("auth-note").textContent = note || "";
    $("auth-note").hidden = !note;
    ["f-login", "f-candidate", "f-company"].forEach(function (id) { clearErrors($(id)); });
    if (!$("auth").open) $("auth").showModal();
    var first = $("f-" + tab).querySelector("input,select");
    if (first) first.focus();
  }

  function showAuthError(msg) {
    var box = $("auth-error");
    box.textContent = msg;
    box.hidden = false;
  }

  function closeAuth() {
    if ($("auth").open) $("auth").close();
    ["f-login", "f-candidate", "f-company"].forEach(function (id) { $(id).reset(); clearErrors($(id)); });
    $$(".pw-toggle").forEach(function (b) { setPwVisible(b, false); });
  }

  function setPwVisible(btn, show) {
    var input = btn.parentElement.querySelector("input");
    input.type = show ? "text" : "password";
    btn.textContent = show ? "Ocultar" : "Mostrar";
    btn.setAttribute("aria-pressed", show ? "true" : "false");
    btn.setAttribute("aria-label", show ? "Ocultar senha" : "Mostrar senha");
  }

  function afterSession(user, goProfile, message) {
    return applySession(user).then(function () {
      closeAuth();
      if (message) toast(message);
      if (goProfile) {
        if (location.hash === "#perfil") route(); else location.hash = "#perfil";
      }
    });
  }

  function onLogin(e) {
    e.preventDefault();
    var form = e.currentTarget;
    $("auth-error").hidden = true;
    if (!validateForm(form)) return;
    setBusy(form, true, "Entrando…");
    provider.signIn($("l-email").value.trim(), $("l-senha").value)
      .then(function (user) {
        var onProfile = location.hash === "#perfil";
          var fromCompany = state.companyIntent || location.hash === "#empresa";
        return afterSession(user, false, null).then(function () {
          if (onProfile) route();
            else if (fromCompany) {
              state.companyIntent = false;
              if (state.profile && state.profile.role === "company") {
                if (location.hash === "#empresa") route(); else location.hash = "#empresa";
              } else {
                toast("Entre com uma conta de empresa para acessar este painel.", "error");
              }
            }
        });
      })
      .catch(function (err) { showAuthError(Auth.explain(err)); })
      .then(function () { setBusy(form, false); });
  }

  function onRegister(role) {
    return function (e) {
      e.preventDefault();
      var form = e.currentTarget;
      $("auth-error").hidden = true;
      if (!validateForm(form)) return;
      var v = {};
      $$("input,select", form).forEach(function (f) { if (f.name) v[f.name] = f.type === "password" ? f.value : f.value.trim(); });
      var base = { role: role, nome: v.nome, cidade: v.cidade || "", headline: "", link: "", avatar: "", color: defaultColor(v.nome) };
      var profile = role === "candidate"
        ? Object.assign(base, { area: v.area, tel: "", esc: "", sobre: "", skills: [] })
        : Object.assign(base, { cnpj: digits(v.cnpj), setor: v.setor, resp: v.resp, desc: "" });
      if (role === "company") profile.cnpj = maskCnpj(profile.cnpj);
      setBusy(form, true, "Criando conta…");
      provider.signUp(v.email, v.senha, profile)
        .then(function (user) {
          if (user.needsConfirmation) {
            closeAuth();
            toast("Conta criada. Confirme seu e-mail antes de entrar.");
            return;
          }
          return afterSession(user, role !== "company", "Conta criada! Aproveite para personalizar seu perfil.")
            .then(function () {
              if (role === "company") {
                state.companyIntent = false;
                location.hash = "#empresa";
              }
            });
        })
        .catch(function (err) { showAuthError(Auth.explain(err)); })
        .then(function () { setBusy(form, false); });
    };
  }

  function setupAuthDialog() {
    $$("[data-open-auth]").forEach(function (b) {
      b.addEventListener("click", function () { openAuth(b.dataset.openAuth); });
    });
      $("nav-company").addEventListener("click", function () {
        if (state.profile && state.profile.role === "company") {
          state.companyIntent = false;
          if (location.hash === "#empresa") route(); else location.hash = "#empresa";
        } else if (state.user) {
          toast("Esta área é exclusiva para contas de empresa.", "error");
        } else {
          state.companyIntent = true;
          openAuth("company", "Crie uma conta de empresa ou entre para publicar vagas.");
        }
      });
    $$("[data-auth-tab]").forEach(function (b) {
      b.addEventListener("click", function () { setAuthTab(b.dataset.authTab); });
    });
    $("auth-x").addEventListener("click", closeAuth);
    $("auth").addEventListener("click", function (e) { if (e.target === $("auth")) closeAuth(); });
    $("auth").addEventListener("cancel", function () { setTimeout(closeAuth, 0); });
    $("f-login").addEventListener("submit", onLogin);
    $("f-candidate").addEventListener("submit", onRegister("candidate"));
    $("f-company").addEventListener("submit", onRegister("company"));
    $$(".pw-toggle").forEach(function (b) {
      b.addEventListener("click", function () { setPwVisible(b, b.getAttribute("aria-pressed") !== "true"); });
    });
    $("forgot").hidden = !provider.canReset;
    $("forgot").addEventListener("click", function () {
      var email = $("l-email").value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        $("l-email").focus();
        showAuthError("Digite seu e-mail no campo acima para receber o link de redefinição.");
        return;
      }
      provider.resetPassword(email)
        .then(function () { $("auth-error").hidden = true; toast("Se houver uma conta com esse e-mail, enviamos o link de redefinição."); })
        .catch(function (err) { showAuthError(Auth.explain(err)); });
    });
    $("auth-mode").textContent = Auth.mode === "local"
      ? "Modo demonstração: as contas ficam salvas somente neste navegador."
      : Auth.mode === "supabase" ? "Contas e vagas compartilhadas pelo Supabase." : "";
    // Limpa o erro de um campo assim que a pessoa o corrige.
    function recheck(e) {
      var f = e.target;
      if (!f.classList || !f.classList.contains("bad")) return;
      var msg = fieldError(f), out = f.closest(".f") && f.closest(".f").querySelector(".err");
      if (out) out.textContent = msg;
      f.classList.toggle("bad", !!msg);
      f.setAttribute("aria-invalid", msg ? "true" : "false");
    }
    document.addEventListener("input", recheck);
    document.addEventListener("change", recheck);

    $$("[data-mask]").forEach(function (input) {
      input.addEventListener("input", function () {
        input.value = input.dataset.mask === "tel" ? maskTel(input.value) : maskCnpj(input.value);
      });
    });
  }

  /* ---------- Sessão e cabeçalho ---------- */
  function firstName(name) { return String(name || "").trim().split(/\s+/)[0] || "Conta"; }

  function renderAuthUI() {
    var signed = !!(state.user && state.profile);
    $("guest-actions").hidden = !state.ready || signed;
    $("user-menu").hidden = !signed;
    $("cta").hidden = signed || !state.ready;
    if (signed) {
      paintAvatar($("hd-avatar"), state.profile);
      $("hd-name").textContent = firstName(state.profile.nome);
      $("user-btn").setAttribute("aria-label", "Menu da conta de " + state.profile.nome);
    } else {
      closeMenu();
    }
  }

  function applySession(user) {
    var seq = ++sessionSeq;
    if (!user) {
      state.user = null;
      state.profile = null;
      return Promise.resolve(finishSession());
    }
    return provider.getProfile(user.uid)
      .then(function (p) { return p || provider.ensureProfile(user); })
      .then(function (p) {
        if (seq !== sessionSeq) return;
        state.user = user;
        state.profile = p;
        return finishSession();
      })
      .catch(function (err) {
        if (seq !== sessionSeq) return;
        toast(Auth.explain(err), "error");
        state.user = null;
        state.profile = null;
        provider.signOut().catch(function () {});
        return finishSession();
      });
  }

  function finishSession() {
    state.ready = true;
    return loadLists().then(function () {
      renderAuthUI();
      renderJobs();
      refreshApplyButton();
      if (state.profile && !$("view-profile").hidden) renderProfile();
      readyResolve();
    });
  }

  function doLogout() {
    closeMenu();
    provider.signOut().then(function () {
      toast("Você saiu da conta.");
      if (location.hash === "#perfil") history.replaceState(null, "", location.pathname + location.search);
      route();
    }).catch(function (err) { toast(Auth.explain(err), "error"); });
  }

  function closeMenu() {
    $("menu").hidden = true;
    $("user-btn").setAttribute("aria-expanded", "false");
  }

  function setupMenu() {
    $("user-btn").addEventListener("click", function (e) {
      e.stopPropagation();
      var open = $("menu").hidden;
      $("menu").hidden = !open;
      $("user-btn").setAttribute("aria-expanded", open ? "true" : "false");
    });
    document.addEventListener("click", function (e) {
      if (!$("user-menu").contains(e.target)) closeMenu();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !$("menu").hidden) { closeMenu(); $("user-btn").focus(); }
    });
    $("menu-profile").addEventListener("click", closeMenu);
    $("menu-logout").addEventListener("click", doLogout);
    $("pf-logout").addEventListener("click", doLogout);
  }

  /* ---------- Rotas (início / perfil) ---------- */
  function route() {
    var hash = location.hash;
    if (hash === "#empresa") {
      return readyPromise.then(function () {
        if (!state.user || !state.profile) {
          history.replaceState(null, "", location.pathname + location.search);
          showView("home");
          state.companyIntent = true;
          openAuth("company", "Entre ou crie uma conta para publicar vagas pela sua empresa.");
          return;
        }
        if (state.profile.role !== "company") {
          history.replaceState(null, "", location.pathname + location.search);
          showView("home");
          toast("Esta área é exclusiva para contas de empresa.", "error");
          return;
        }
        showView("company");
      });
    }
    if (hash === "#perfil") {
      return readyPromise.then(function () {
        if (!state.user || !state.profile) {
          history.replaceState(null, "", location.pathname + location.search);
          showView("home");
          openAuth("login", "Entre para acessar e personalizar seu perfil.");
          return;
        }
        showView("profile");
      });
    }
    showView("home");
    var id = hash.slice(1);
    if (id && $(id)) $(id).scrollIntoView();
    return Promise.resolve();
  }

  function showView(name) {
    var profile = name === "profile";
    var company = name === "company";
    var wasSubpage = !$ ("view-profile").hidden || !$ ("view-company").hidden;
    $("view-home").hidden = profile || company;
    $("view-profile").hidden = !profile;
    $("view-company").hidden = !company;
    if (profile) {
      renderProfile();
      window.scrollTo(0, 0);
      $("pf-title").focus({ preventScroll: true });
    } else if (company) {
      $("company-page-title").textContent = state.profile.nome;
      $("company-page-subtitle").textContent = state.profile.headline || "Gerencie as oportunidades da sua empresa.";
      renderCompanyJobs();
      renderCompanyApplications();
      window.scrollTo(0, 0);
      $("company-page-title").focus({ preventScroll: true });
    } else if (wasSubpage) {
      window.scrollTo(0, 0);
    }
  }

  /* ---------- Perfil ---------- */
  var FIELDS = {
    candidate: ["nome", "headline", "cidade", "tel", "area", "esc", "sobre"],
    company: ["nome", "headline", "cidade", "cnpj", "setor", "resp", "desc"]
  };

  function pf(name) { return $("profile-form").elements.namedItem(name); }

  function renderSwatches() {
    var box = $("swatches");
    box.innerHTML = "";
    COLORS.forEach(function (c) {
      var label = document.createElement("label");
      label.className = "sw";
      var input = document.createElement("input");
      input.type = "radio";
      input.name = "cor";
      input.value = c[0];
      input.checked = c[0] === draft.color;
      input.setAttribute("aria-label", c[1]);
      input.setAttribute("data-skip", "");
      var dot = document.createElement("span");
      dot.style.setProperty("--c", c[0]);
      label.appendChild(input);
      label.appendChild(dot);
      input.addEventListener("change", function () { draft.color = c[0]; updatePreview(); });
      box.appendChild(label);
    });
  }

  function renderSkills() {
    var ul = $("skills");
    ul.innerHTML = "";
    draft.skills.forEach(function (s, i) {
      var li = document.createElement("li");
      li.appendChild(document.createTextNode(s));
      var rm = document.createElement("button");
      rm.type = "button";
      rm.textContent = "×";
      rm.setAttribute("aria-label", "Remover " + s);
      rm.addEventListener("click", function () {
        draft.skills.splice(i, 1);
        renderSkills();
        updatePreview();
        $("skill-input").focus();
      });
      li.appendChild(rm);
      ul.appendChild(li);
    });
    $("skills-hint").textContent = draft.skills.length >= 12
      ? "Limite de 12 habilidades atingido."
      : draft.skills.length + " de 12 habilidades.";
  }

  function addSkill(raw) {
    var s = String(raw || "").replace(/[,;]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 30);
    if (!s) return;
    if (draft.skills.length >= 12) { toast("Você pode adicionar até 12 habilidades.", "error"); return; }
    var exists = draft.skills.some(function (x) { return x.toLowerCase() === s.toLowerCase(); });
    if (!exists) draft.skills.push(s);
    renderSkills();
    updatePreview();
  }

  function renderProfile() {
    var p = state.profile;
    if (!p) return;
    var role = p.role === "company" ? "company" : "candidate";
    var form = $("profile-form");
    form.dataset.role = role;
    $$("[data-role]", form).forEach(function (el) { el.hidden = el.dataset.role !== role; });
    var company = role === "company";
    $("l-nome").textContent = company ? "Nome da empresa" : "Nome completo";
    $("l-headline").textContent = company ? "Slogan" : "Título profissional";
    $("pf-headline").placeholder = company ? "Ex.: Tecnologia que aproxima pessoas" : "Ex.: Desenvolvedora front-end em formação";
    $("l-photo").textContent = company ? "Logo da empresa" : "Foto de perfil";
    $("l-link").textContent = company ? "Site da empresa" : "LinkedIn ou site pessoal";
    $("pf-link").placeholder = company ? "suaempresa.com.br" : "linkedin.com/in/seu-nome";
    $("lg-about").textContent = company ? "Sobre a empresa" : "Sobre você";
    $("pf-email").textContent = p.email || (state.user && state.user.email) || "";
    $("pf-status").textContent = "";

    FIELDS[role].forEach(function (k) { var el = pf(k); if (el) el.value = p[k] || ""; });
    pf("link").value = p.link || "";
    clearErrors(form);

    draft = {
      avatar: typeof p.avatar === "string" ? p.avatar : "",
      color: validColor(p.color) || defaultColor(p.nome),
      skills: Array.isArray(p.skills) ? p.skills.slice(0, 12) : []
    };
    renderSwatches();
    renderSkills();
    updatePreview();
    $("pf-title").textContent = company ? "Perfil da empresa" : "Meu perfil";
  }

  function renderCompanyJobs() {
    if (!state.profile || state.profile.role !== "company") return;
    var ownJobs = state.companyJobs.filter(function (job) { return job.companyId === state.user.uid; });
    $("company-jobs-count").textContent = ownJobs.length + (ownJobs.length === 1 ? " vaga publicada" : " vagas publicadas");
    $("company-mode-note").textContent = Auth.mode === "local"
      ? "Modo demonstração: suas vagas ficam salvas neste navegador e não aparecem para outros visitantes."
      : Auth.mode === "supabase"
        ? "As vagas são armazenadas no Supabase e ficam disponíveis para todos os visitantes."
        : "As vagas publicadas ficam disponíveis na lista pública do site.";
    if (!ownJobs.length) {
      $("company-jobs-list").innerHTML = '<p class="empty-note">Você ainda não publicou vagas.</p>';
      return;
    }
    $("company-jobs-list").innerHTML = ownJobs.map(function (job) {
      return '<article class="company-listing"><div><h3>' + esc(job.title) + '</h3><p>' + esc(job.city) + " · " + esc(job.mode) + " · " + esc(job.employmentType) + '</p></div>' +
        '<button class="btn ghost sm" type="button" data-delete-job="' + esc(job.id) + '">Remover</button></article>';
    }).join("");
  }

  function renderCompanyApplications() {
    var panel = $("company-applications");
    if (Auth.mode !== "supabase" || !state.user || !state.profile || state.profile.role !== "company") {
      panel.innerHTML = '<p class="empty-note">As candidaturas aparecerão aqui quando o Supabase estiver configurado.</p>';
      return;
    }
    panel.innerHTML = '<p class="empty-note">Carregando candidaturas…</p>';
    provider.listCompanyApplications(state.user.uid).then(function (applications) {
      if (!applications.length) {
        panel.innerHTML = '<p class="empty-note">Você ainda não recebeu candidaturas.</p>';
        return;
      }
      panel.innerHTML = applications.map(function (application) {
        return '<article class="company-listing"><div><h3>' + esc(application.candidate_name) + '</h3><p>' +
          esc(application.candidate_email) + ' · ' + esc(application.jobs.title) + '</p></div><span class="tag">' +
          esc(new Date(application.created_at).toLocaleDateString("pt-BR")) + '</span></article>';
      }).join("");
    }).catch(function (err) {
      panel.innerHTML = '<p class="empty-note">Não foi possível carregar as candidaturas.</p>';
      toast(Auth.explain(err), "error");
    });
  }

  function publishJob(e) {
    e.preventDefault();
    if (!state.user || !state.profile || state.profile.role !== "company") return;
    var form = $("job-form");
    if (!validateForm(form)) return;
    var job = {
      companyName: state.profile.nome,
      title: $("job-title").value.trim(), area: $("job-area").value,
      city: $("job-city").value.trim(), mode: $("job-mode").value,
      employmentType: $("job-type").value, salary: $("job-salary").value.trim() || "A combinar",
      description: $("job-description").value.trim(),
      color: validColor(state.profile.color) || defaultColor(state.profile.nome)
    };
    setBusy(form, true, "Publicando...");
    provider.createJob(state.user.uid, job).then(function (saved) {
      state.companyJobs.unshift(saved);
      JOBS.unshift(normalizePublishedJob(saved));
      refreshSearchOptions();
      renderJobs();
      renderCompanyJobs();
      form.reset();
      toast("Vaga publicada.");
    }).catch(function (err) {
      toast(Auth.explain(err), "error");
    }).then(function () { setBusy(form, false); });
  }

  function deleteCompanyJob(id) {
    provider.deleteJob(state.user.uid, id).then(function () {
      state.companyJobs = state.companyJobs.filter(function (job) { return job.id !== id; });
      JOBS = JOBS.filter(function (job) { return job.id !== id; });
      refreshSearchOptions();
      renderJobs();
      renderCompanyJobs();
      toast("Vaga removida.");
    }).catch(function (err) { toast(Auth.explain(err), "error"); });
  }

  function formValue(name) { var el = pf(name); return el ? el.value.trim() : ""; }

  function updateCounts() {
    $$("[data-count]").forEach(function (span) {
      var ta = $(span.dataset.count);
      span.textContent = ta.value.length + " de " + ta.maxLength + " caracteres";
    });
  }

  function updatePreview() {
    if (!state.profile) return;
    var role = state.profile.role === "company" ? "company" : "candidate";
    var company = role === "company";
    var nome = formValue("nome") || (company ? "Sua empresa" : "Seu nome");
    var data = { nome: nome, avatar: draft.avatar, color: draft.color };
    paintAvatar($("pv-avatar"), data);
    paintAvatar($("ed-avatar"), data);
    $("pv-card").style.setProperty("--pc", draft.color);
    $("pv-name").textContent = nome;
    $("pv-headline").textContent = formValue("headline");

    var meta = [formValue("cidade"), company ? formValue("setor") : formValue("area")].filter(Boolean);
    if (!company && formValue("esc")) meta.push(formValue("esc"));
    $("pv-meta").textContent = meta.join(" – ");
    $("pv-about").textContent = company ? formValue("desc") : formValue("sobre");

    var ul = $("pv-skills");
    ul.innerHTML = "";
    if (!company) {
      draft.skills.forEach(function (s) {
        var li = document.createElement("li");
        li.textContent = s;
        ul.appendChild(li);
      });
    }
    ul.hidden = !ul.children.length;

    var link = $("pv-link"), url = normalizeUrl(formValue("link"));
    if (url) {
      link.href = url;
      link.textContent = url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
      link.hidden = false;
    } else {
      link.hidden = true;
    }

    var checks = company
      ? [["logo", !!draft.avatar], ["slogan", !!formValue("headline")], ["cidade", !!formValue("cidade")], ["CNPJ", validCnpj(formValue("cnpj"))],
         ["setor", !!formValue("setor")], ["responsável", !!formValue("resp")], ["descrição", !!formValue("desc")], ["site", !!url]]
      : [["foto", !!draft.avatar], ["título profissional", !!formValue("headline")], ["cidade", !!formValue("cidade")], ["telefone", digits(formValue("tel")).length >= 10],
         ["área de interesse", !!formValue("area")], ["escolaridade", !!formValue("esc")], ["resumo", !!formValue("sobre")],
         ["habilidades", draft.skills.length > 0], ["link", !!url]];
    var done = checks.filter(function (c) { return c[1]; }).length;
    var pct = Math.round(done / checks.length * 100);
    $("pv-pct").textContent = pct + "%";
    $("pv-fill").style.width = pct + "%";
    $("pv-bar").setAttribute("aria-valuenow", String(pct));
    var missing = checks.filter(function (c) { return !c[1]; }).map(function (c) { return c[0]; });
    $("pv-tip").textContent = missing.length
      ? "Falta preencher: " + missing.slice(0, 3).join(", ") + (missing.length > 3 ? " e mais " + (missing.length - 3) : "") + "."
      : "Tudo preenchido. Seu perfil está completo.";
    updateCounts();
  }

  function resizeImage(file, size) {
    return new Promise(function (resolve, reject) {
      if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) return reject(new Error("Formato não suportado. Use JPG, PNG ou WebP."));
      if (file.size > 8 * 1024 * 1024) return reject(new Error("A imagem é grande demais. Use um arquivo de até 8 MB."));
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var s = Math.min(img.width, img.height), c = document.createElement("canvas");
        c.width = c.height = size;
        var ctx = c.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, size, size);
        ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
        resolve(c.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("Não foi possível ler essa imagem.")); };
      img.src = url;
    });
  }

  function saveProfile(e) {
    e.preventDefault();
    var form = $("profile-form");
    if (!state.user || !state.profile) return;
    if (!validateForm(form)) return;
    var role = state.profile.role === "company" ? "company" : "candidate";
    var changes = {};
    FIELDS[role].forEach(function (k) { changes[k] = formValue(k); });
    if (role === "company") changes.cnpj = maskCnpj(changes.cnpj);
    changes.link = normalizeUrl(formValue("link")) || "";
    changes.avatar = draft.avatar;
    changes.color = draft.color;
    if (role === "candidate") changes.skills = draft.skills.slice();
    setBusy(form, true, "Salvando…");
    $("pf-status").textContent = "";
    provider.saveProfile(state.user.uid, changes)
      .then(function (saved) {
        state.profile = saved || Object.assign({}, state.profile, changes);
        renderAuthUI();
        renderProfile();
        $("pf-status").textContent = "Alterações salvas.";
        toast("Perfil atualizado.");
      })
      .catch(function (err) { $("pf-status").textContent = ""; toast(Auth.explain(err), "error"); })
      .then(function () { setBusy(form, false); });
  }

  function setupProfile() {
    var form = $("profile-form");
    form.addEventListener("submit", saveProfile);
    $("job-form").addEventListener("submit", publishJob);
    $("company-jobs-list").addEventListener("click", function (e) {
      var button = e.target.closest("[data-delete-job]");
      if (button) deleteCompanyJob(button.dataset.deleteJob);
    });
    form.addEventListener("input", function (e) {
      if (e.target.dataset && e.target.dataset.mask) {
        e.target.value = e.target.dataset.mask === "tel" ? maskTel(e.target.value) : maskCnpj(e.target.value);
      }
      updatePreview();
    });
    $("pf-reset").addEventListener("click", function () { renderProfile(); toast("Alterações descartadas."); });
    $("photo-pick").addEventListener("click", function () { $("pf-photo").click(); });
    $("photo-remove").addEventListener("click", function () { draft.avatar = ""; updatePreview(); });
    $("pf-photo").addEventListener("change", function (e) {
      var file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!file) return;
      resizeImage(file, 256)
        .then(function (data) { draft.avatar = data; updatePreview(); })
        .catch(function (err) { toast(err.message, "error"); });
    });
    var input = $("skill-input");
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addSkill(input.value); input.value = ""; }
      else if (e.key === "Backspace" && !input.value && draft.skills.length) { draft.skills.pop(); renderSkills(); updatePreview(); }
    });
    input.addEventListener("blur", function () { if (input.value.trim()) { addSkill(input.value); input.value = ""; } });
    $("skills-box").addEventListener("click", function (e) { if (e.target === $("skills-box")) input.focus(); });
  }

  /* ---------- Eventos globais ---------- */
  function setupJobEvents() {
    $("lista").addEventListener("click", function (e) {
      if (e.target.closest("[data-tab-reset]")) {
        state.tab = "todas";
        $$("[data-tab]").forEach(function (x) { x.setAttribute("aria-pressed", x.dataset.tab === "todas" ? "true" : "false"); });
        renderJobs();
        return;
      }
      var fav = e.target.closest("[data-fav]");
      if (fav) { toggleSaved(fav.dataset.fav); return; }
      var view = e.target.closest("[data-view]");
      if (view) { var j = jobById(view.dataset.view); if (j) showJob(j); }
    });
    $("jd-x").addEventListener("click", function () { $("job-dlg").close(); });
    $("jd-close").addEventListener("click", function () { $("job-dlg").close(); });
    $("job-dlg").addEventListener("click", function (e) { if (e.target === $("job-dlg")) $("job-dlg").close(); });
    $("job-dlg").addEventListener("close", function () { openJob = null; });
    $("jd-apply").addEventListener("click", applyToJob);
  }

  /* ---------- Inicialização ---------- */
  setupSearch();
  setupJobEvents();
  setupAuthDialog();
  setupMenu();
  setupProfile();
  loadPublishedJobs();
  refreshThemeButton();
  renderJobs();
  window.addEventListener("hashchange", route);

  provider.start(function (user) { applySession(user).then(route); })
    .catch(function (err) {
      toast(Auth.explain(err), "error");
      state.ready = true;
      renderAuthUI();
      readyResolve();
      route();
    });
})();
