/* Ija Nbadlou — bouton "Continuer avec WhatsApp" (compte par numéro de téléphone)
 *
 * Ajoute sous Google / Facebook un bouton WhatsApp qui ouvre un petit formulaire :
 * prénom, nom, adresse, numéro WhatsApp + mot de passe.
 * Le compte est un compte Firebase "email/mot de passe" dont l'email est fabriqué
 * à partir du numéro (wa21620123456@tel.ija-nbadlou.tn). Aucun vrai email n'est envoyé.
 *
 * Nécessite : Firebase Console > Authentication > Sign-in method > Email/Password = activé.
 * Pour garder l'adresse + le numéro : règle Firestore "users" (voir firestore-users-rule.txt).
 */
(function(){
  "use strict";

  var FAKE_DOMAIN = "tel.ija-nbadlou.tn";

  var STR = {
    fr: {
      btn: "Continuer avec WhatsApp",
      intro_new: "Crée ton compte avec ton numéro WhatsApp.",
      intro_login: "Connecte-toi avec ton numéro WhatsApp et ton mot de passe.",
      first: "Prénom", last: "Nom", addr: "Adresse (ville, quartier)",
      phone: "Numéro WhatsApp", phone_ph: "ex. 20 123 456",
      pass: "Mot de passe (6 caractères minimum)",
      go_new: "Créer mon compte", go_login: "Me connecter",
      to_login: "J'ai déjà un compte", to_new: "Créer un nouveau compte",
      private: "Ton numéro et ton adresse ne sont visibles que par toi.",
      e_first: "Écris ton prénom.", e_last: "Écris ton nom.", e_addr: "Écris ton adresse (ville, quartier).",
      e_phone: "Numéro invalide. Exemple : 20 123 456.",
      e_pass: "Mot de passe trop court (6 caractères minimum).",
      e_exists: "Ce numéro a déjà un compte. Connecte-toi avec ton mot de passe.",
      e_bad: "Numéro ou mot de passe incorrect.",
      e_off: "La connexion par numéro n'est pas encore activée sur le site.",
      e_net: "Pas de connexion internet. Réessaie.",
      e_many: "Trop d'essais. Réessaie dans quelques minutes.",
      e_other: "Impossible de continuer. Réessaie.",
      ok_new: "Compte créé ✔", ok_login: "Connecté ✔"
    },
    ar: {
      btn: "الدخول بـ WhatsApp",
      intro_new: "اعمل حسابك برقم WhatsApp متاعك.",
      intro_login: "ادخل برقم WhatsApp وكلمة السر متاعك.",
      first: "الاسم", last: "اللقب", addr: "العنوان (المدينة، الحي)",
      phone: "رقم WhatsApp", phone_ph: "مثلا 20 123 456",
      pass: "كلمة السر (6 حروف على الأقل)",
      go_new: "نعمل الحساب", go_login: "ندخل",
      to_login: "عندي حساب", to_new: "نعمل حساب جديد",
      private: "رقمك وعنوانك ما يشوفهم كان إنت.",
      e_first: "اكتب اسمك.", e_last: "اكتب لقبك.", e_addr: "اكتب عنوانك (المدينة، الحي).",
      e_phone: "الرقم غالط. مثال: 20 123 456.",
      e_pass: "كلمة السر قصيرة (6 حروف على الأقل).",
      e_exists: "هذا الرقم عندو حساب. ادخل بكلمة السر متاعك.",
      e_bad: "الرقم ولا كلمة السر غالطين.",
      e_off: "الدخول بالرقم مازال ما تفعلش في الموقع.",
      e_net: "ما فماش إنترنت. عاود جرب.",
      e_many: "برشا محاولات. عاود جرب بعد شوية.",
      e_other: "ما نجمناش نكملو. عاود جرب.",
      ok_new: "الحساب تعمل ✔", ok_login: "دخلت ✔"
    }
  };

  var WA_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#fff" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>';

  var mode = "new";          // "new" (créer) | "login" (j'ai déjà un compte)
  var lastOpener = null;     // bouton qui a ouvert la fenêtre de connexion (pour reprendre l'action après)
  var busy = false;

  function lang(){
    var l = (document.body && document.body.getAttribute("lang")) || document.documentElement.getAttribute("lang") || "fr";
    return l === "ar" ? "ar" : "fr";
  }
  function T(k){ return STR[lang()][k]; }

  /* ---------- numéro -> chiffres internationaux (216XXXXXXXX) ---------- */
  function normPhone(raw){
    var s = String(raw || "").replace(/[٠-٩]/g, function(c){ return String(c.charCodeAt(0) - 1632); });
    var d = s.replace(/\D/g, "");
    if(d.indexOf("00") === 0) d = d.slice(2);
    if(d.length === 8) d = "216" + d;
    if(d.indexOf("216") === 0){
      if(!/^216[2-9]\d{7}$/.test(d)) return null;
    }
    if(d.length < 9 || d.length > 15) return null;
    return d;
  }

  /* ---------- styles ---------- */
  function addStyles(){
    if(document.getElementById("wa-login-css")) return;
    var st = document.createElement("style");
    st.id = "wa-login-css";
    st.textContent =
      ".login-btn.whatsapp{ background:#25d366; color:#fff; border-color:#25d366; }" +
      "#wa-form{ display:none; flex-direction:column; gap:12px; margin:2px 0 14px; padding:14px; border-radius:12px; border:1.5px solid var(--line); }" +
      "#wa-form.open{ display:flex; }" +
      "#wa-form .wa-intro{ margin:0; font-size:.92rem; line-height:1.5; color:var(--ink-soft); }" +
      "#wa-form .field.span2{ grid-column:auto; }" +
      "#wa-form .wa-row{ display:grid; grid-template-columns:1fr 1fr; gap:10px; }" +
      "@media (max-width:420px){ #wa-form .wa-row{ grid-template-columns:1fr; } }" +
      "#wa-form .wa-go{ margin:2px 0 0; background:#25d366; color:#fff; border-color:#25d366; }" +
      "#wa-form .wa-switch{ align-self:center; background:none; border:0; color:var(--accent); font:inherit; font-size:.9rem; text-decoration:underline; cursor:pointer; padding:4px; }" +
      "#wa-form .wa-note{ margin:0; font-size:.8rem; color:var(--ink-soft); text-align:center; }" +
      "#wa-form .wa-err{ margin:0; }";
    document.head.appendChild(st);
  }

  /* ---------- construction du bouton + formulaire ---------- */
  function field(id, labelKey, attrs){
    var d = document.createElement("div");
    d.className = "field";
    d.innerHTML = '<label for="' + id + '" data-wk="' + labelKey + '"></label><input id="' + id + '" ' + attrs + '>';
    return d;
  }

  function build(){
    var fb = document.getElementById("login-facebook");
    if(!fb || document.getElementById("login-whatsapp")) return;

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "login-btn whatsapp";
    btn.id = "login-whatsapp";
    btn.innerHTML = WA_ICON + '<span data-wk="btn"></span>';
    fb.parentNode.insertBefore(btn, fb.nextSibling);

    var f = document.createElement("form");
    f.id = "wa-form";
    f.setAttribute("novalidate", "novalidate");
    f.innerHTML = '<p class="wa-intro" id="wa-intro"></p>';

    var row = document.createElement("div");
    row.className = "wa-row";
    row.id = "wa-names";
    row.appendChild(field("wa-first", "first", 'type="text" maxlength="30" autocomplete="given-name"'));
    row.appendChild(field("wa-last", "last", 'type="text" maxlength="30" autocomplete="family-name"'));
    f.appendChild(row);

    var addr = field("wa-addr", "addr", 'type="text" maxlength="120" autocomplete="street-address"');
    addr.id = "wa-addr-wrap";
    f.appendChild(addr);

    f.appendChild(field("wa-phone", "phone", 'type="tel" inputmode="tel" dir="ltr" maxlength="20" autocomplete="tel"'));
    f.appendChild(field("wa-pass", "pass", 'type="password" dir="ltr" maxlength="60" autocomplete="new-password"'));

    var go = document.createElement("button");
    go.type = "submit";
    go.className = "login-btn wa-go";
    go.id = "wa-go";
    f.appendChild(go);

    var err = document.createElement("p");
    err.className = "login-err wa-err";
    err.id = "wa-err";
    err.hidden = true;
    f.appendChild(err);

    var sw = document.createElement("button");
    sw.type = "button";
    sw.className = "wa-switch";
    sw.id = "wa-switch";
    f.appendChild(sw);

    var note = document.createElement("p");
    note.className = "wa-note";
    note.id = "wa-note";
    f.appendChild(note);

    btn.parentNode.insertBefore(f, btn.nextSibling);

    btn.addEventListener("click", function(){
      var open = !f.classList.contains("open");
      f.classList.toggle("open", open);
      if(open){ setMode("new"); var p = document.getElementById("wa-first"); if(p) p.focus(); }
    });
    sw.addEventListener("click", function(){ setMode(mode === "new" ? "login" : "new"); });
    f.addEventListener("submit", function(e){ e.preventDefault(); submit(); });

    render();
  }

  function setMode(m){
    mode = m;
    hideErr();
    render();
  }

  function render(){
    var nodes = document.querySelectorAll("#login-whatsapp [data-wk], #wa-form [data-wk]");
    for(var i = 0; i < nodes.length; i++){ nodes[i].textContent = T(nodes[i].getAttribute("data-wk")); }
    var ph = document.getElementById("wa-phone"); if(ph) ph.placeholder = T("phone_ph");
    var isNew = mode === "new";
    var names = document.getElementById("wa-names"), addr = document.getElementById("wa-addr-wrap");
    if(names) names.style.display = isNew ? "" : "none";
    if(addr) addr.style.display = isNew ? "" : "none";
    var pw = document.getElementById("wa-pass");
    if(pw) pw.setAttribute("autocomplete", isNew ? "new-password" : "current-password");
    var s;
    s = document.getElementById("wa-intro"); if(s) s.textContent = T(isNew ? "intro_new" : "intro_login");
    s = document.getElementById("wa-go"); if(s) s.textContent = T(isNew ? "go_new" : "go_login");
    s = document.getElementById("wa-switch"); if(s) s.textContent = T(isNew ? "to_login" : "to_new");
    s = document.getElementById("wa-note"); if(s) s.textContent = isNew ? T("private") : "";
  }

  function showErr(msg){ var e = document.getElementById("wa-err"); if(e){ e.textContent = msg; e.hidden = false; } }
  function hideErr(){ var e = document.getElementById("wa-err"); if(e){ e.hidden = true; e.textContent = ""; } }
  function setBusy(b){
    busy = b;
    var go = document.getElementById("wa-go"); if(go) go.disabled = b;
    var sw = document.getElementById("wa-switch"); if(sw) sw.disabled = b;
  }
  function toast(msg){
    var el = document.getElementById("toast");
    if(!el) return;
    el.textContent = msg;
    el.classList.add("show");
    setTimeout(function(){ el.classList.remove("show"); }, 2600);
  }
  function val(id){ var e = document.getElementById(id); return e ? e.value.trim() : ""; }

  /* ---------- erreurs Firebase -> message ---------- */
  function mapError(err){
    var c = (err && err.code) || "";
    if(c === "auth/email-already-in-use") return "exists";
    if(c === "auth/wrong-password" || c === "auth/user-not-found" || c === "auth/invalid-credential" ||
       c === "auth/invalid-login-credentials" || c === "auth/invalid-email") return "e_bad";
    if(c === "auth/weak-password") return "e_pass";
    if(c === "auth/operation-not-allowed" || c === "auth/admin-restricted-operation") return "e_off";
    if(c === "auth/network-request-failed") return "e_net";
    if(c === "auth/too-many-requests") return "e_many";
    return "e_other";
  }

  /* ---------- envoi ---------- */
  function submit(){
    if(busy) return;
    hideErr();
    if(!window.firebase || !firebase.auth){ showErr(T("e_other")); return; }

    var isNew = mode === "new";
    var first = val("wa-first"), last = val("wa-last"), addr = val("wa-addr");
    var pass = document.getElementById("wa-pass").value;
    var digits = normPhone(val("wa-phone"));

    if(isNew && !first){ showErr(T("e_first")); return; }
    if(isNew && !last){ showErr(T("e_last")); return; }
    if(isNew && !addr){ showErr(T("e_addr")); return; }
    if(!digits){ showErr(T("e_phone")); return; }
    if(pass.length < 6){ showErr(T("e_pass")); return; }

    var email = "wa" + digits + "@" + FAKE_DOMAIN;
    var auth = firebase.auth();
    var cur = auth.currentUser;
    setBusy(true);

    var p;
    if(isNew){
      if(cur && cur.isAnonymous){
        // on garde le même compte (mêmes annonces / messages) en lui ajoutant le numéro
        p = cur.linkWithCredential(firebase.auth.EmailAuthProvider.credential(email, pass));
        p = p.then(function(res){ return (res && res.user) || auth.currentUser; });
      } else {
        p = auth.createUserWithEmailAndPassword(email, pass).then(function(res){ return res.user; });
      }
      p = p.then(function(user){
        var name = (first + " " + last).trim();
        var jobs = [];
        try{ jobs.push(user.updateProfile({ displayName: name })); }catch(e){}
        try{
          if(firebase.firestore){
            jobs.push(firebase.firestore().collection("users").doc(user.uid).set({
              firstName: first, lastName: last, address: addr, phone: "+" + digits,
              updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true }));
          }
        }catch(e){}
        // si Firestore refuse (règles pas encore ajoutées), le compte est quand même créé
        return Promise.all(jobs.map(function(j){ return Promise.resolve(j).catch(function(){}); })).then(function(){ return user; });
      });
    } else {
      p = auth.signInWithEmailAndPassword(email, pass);
    }

    p.then(function(){
      setBusy(false);
      document.getElementById("wa-pass").value = "";
      done(isNew);
    }).catch(function(err){
      setBusy(false);
      var k = mapError(err);
      if(k === "exists"){ setMode("login"); showErr(T("e_exists")); return; }
      if(k === "e_other" || k === "e_off"){ try{ console.error("[wa-login]", err); }catch(e){} }
      showErr(T(k));
    });
  }

  function done(isNew){
    var login = document.getElementById("login");
    if(login) login.hidden = true;
    var f = document.getElementById("wa-form");
    if(f) f.classList.remove("open");
    toast(T(isNew ? "ok_new" : "ok_login"));
    // on reprend l'action que la personne voulait faire (ex. "Publier une annonce")
    var op = lastOpener;
    if(op && document.contains(op) && !(login && login.contains(op))){
      setTimeout(function(){ try{ op.click(); }catch(e){} }, 350);
    }
  }

  /* ---------- mémoriser le bouton qui a ouvert la fenêtre de connexion ---------- */
  document.addEventListener("click", function(e){
    var login = document.getElementById("login");
    if(login && login.contains(e.target)) return;
    var b = e.target && e.target.closest ? e.target.closest("button, a, [role=button]") : null;
    if(b) lastOpener = b;
  }, true);

  /* ---------- démarrage ---------- */
  function init(){
    addStyles();
    build();
    // la langue change (AR/FR) : on retraduit
    try{
      var mo = new MutationObserver(function(){ render(); });
      mo.observe(document.body, { attributes: true, attributeFilter: ["lang"] });
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
    }catch(e){}
  }
  if(document.readyState === "loading"){ document.addEventListener("DOMContentLoaded", init); } else { init(); }
})();
