(() => {
  const $ = id => document.getElementById(id);
  let submitting = false, challengeLoading = false;
  let mode = 'login', siteConfig, challengeToken = '', widget, current, orderPage = 0;
  const linkToken = new URLSearchParams(location.hash.slice(1)).get('token');
  const message = value => { $('message').textContent = value || ''; };
  async function api(action, body) {
    const r = await fetch('/api/account/' + action, body === undefined ? {credentials:'same-origin'} : {method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data = await r.json().catch(()=>{throw new Error("Rewards is temporarily unavailable. Please try again shortly.");});
    if (!r.ok) throw new Error(data.message || (r.status === 401 ? 'Please sign in to continue.' : 'Please try again shortly.'));
    return data;
  }
  function ensureChallenge() {
    if (!siteConfig || challengeLoading || widget !== undefined) return;
    challengeLoading = true;
    const script=document.createElement('script');
    script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.onload=()=>{challengeLoading=false;widget=window.turnstile.render('#challenge',{sitekey:siteConfig.siteKey,theme:'dark',size:window.innerWidth<380?'compact':'normal',callback:t=>{challengeToken=t;},'expired-callback':()=>{challengeToken='';}});};
    script.onerror=()=>{challengeLoading=false;message('Verification could not load. Check your connection and try again.');};
    document.head.append(script);
  }
  function setMode(value) {
    mode = value; message('');
    const signup = mode === 'signup', confirm = mode === 'confirm';
    $('profile').hidden = !signup; $('consents').hidden = !signup;
    for (const name of ['name','phone','address','city','state','zip']) $('access-form').elements[name].required = signup;
    $('email-label').hidden = confirm; $('access-form').elements.email.required = !confirm;
    $('password-label').hidden = !['login','confirm'].includes(mode);
    $('access-form').elements.password.required = ['login','confirm'].includes(mode);
    $('access-form').elements.password.autocomplete = confirm ? 'new-password' : 'current-password';
    $('forgot').hidden = !['login','confirm'].includes(mode); $('forgot').textContent = confirm ? 'Request a new password link' : 'Forgot password?'; $('challenge').hidden = confirm;
    if (!confirm) ensureChallenge();
    $('form-title').textContent = {login:'Welcome back',signup:'Make it your Gigi’s',claim:'Keep your VIP benefits',reset:'Get back into your account',confirm:'Choose your password'}[mode];
    $('form-detail').textContent = signup ? 'Use your email as your username. We’ll email a secure link where you can choose a password and activate your account.' : confirm ? 'Choose at least 12 characters. Your email is your username.' : mode === 'claim' ? 'Enter the email you used for the VIP Club. Your existing free-pie code stays with you.' : 'Use the email associated with your account.';
    $('submit').textContent = {login:'Sign in',signup:'Create my account',claim:'Email my secure link',reset:'Send reset link',confirm:'Save password & sign in'}[mode];
    document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('selected',b.dataset.mode === mode));
  }
  function renderOrders(orders, append = false) {
    if (!append) $('orders').replaceChildren();
    if (!orders.length && !append) { $('orders').textContent = 'Your next order will appear here. Past orders placed with your verified email are linked automatically.'; }
    for (const order of orders) {
      const row = document.createElement('div'); row.className='order';
      const info = document.createElement('div'), title = document.createElement('strong'), detail = document.createElement('p'), date = document.createElement('p');
      title.textContent = new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(order.total/100);
      const lines = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;
      detail.textContent = (lines || []).map(l => `${l.quantity} × ${l.itemName}`).join(' · ');
      date.textContent = `${new Date(order.created_at).toLocaleDateString()} · ${order.fulfillment}`;
      info.append(title,date,detail); row.append(info);
      const button = document.createElement('button'); button.textContent='Reorder';
      button.onclick=async()=>{button.disabled=true;try {const r=await api('reorder',{orderId:order.id});
        let cartHasItems = false;
        try { const saved = JSON.parse(localStorage.getItem('gigis_cart_v1') || '[]'); cartHasItems = Array.isArray(saved) && saved.length > 0; }
        catch { cartHasItems = true; /* If storage is unavailable, ask before replacing anything. */ }
        if (cartHasItems && !window.confirm('You already have items in your cart. Replace them with this past order?')) { button.disabled=false; return; }
        sessionStorage.setItem('gigis_rewards_reorder',JSON.stringify(r.lines));location.href='/#menu';}catch(e){message(e.message);button.disabled=false;}};
      row.append(button);$('orders').append(row);
    }
    $('more-orders').hidden = orders.length < 10;
  }
  async function dashboard() {
    current = await api('me');$('auth').hidden=true;$('dashboard').hidden=false;$('greeting').textContent=`Hi, ${current.account.name}`;
    const pie=current.pie, used=!!pie?.redeemed_at, expired=!!pie?.expires_at && Date.parse(pie.expires_at)<=Date.now(), held=!!pie?.reservation_key;
    $('pie-status').textContent=!pie?'Membership review needed':used?'Used':expired?'Expired':held?'Reserved for an order':'Available';
    $('pie-code').textContent=pie?.code || 'No code issued';$('copy-code').hidden=!pie || used || expired || held;
    $('pie-expiry').textContent=used?`Redeemed ${new Date(pie.redeemed_at).toLocaleDateString()}. This code cannot be used again.`:expired?'This code has expired.':held?'This code is held while an order is being resolved.':pie?.expires_at?`Use by ${new Date(pie.expires_at).toLocaleDateString()}`:'Contact the restaurant if you need help with your welcome gift.';
    $('consent-form').querySelector('button').disabled=!current.member;
    $('consent-form').elements.sms.checked=!!(current.member?.sms_consent || current.member?.sms_requested);$('consent-form').elements.email.checked=!!current.member?.email_consent;
    orderPage=0;renderOrders(current.orders);
  }
  document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));$('forgot').onclick=()=>setMode('reset');
  $('access-form').onsubmit=async e=>{e.preventDefault();if(submitting)return;submitting=true;const button=$('submit');button.disabled=true;message('');const fields=Object.fromEntries(new FormData(e.target));
    try {const body={...fields,source:new URLSearchParams(location.search).get("source"),turnstileToken:challengeToken,consentText:siteConfig.consentText,smsConsent:e.target.elements.smsConsent.checked,emailConsent:e.target.elements.emailConsent.checked};
      const action={login:'login',signup:'signup',claim:'claim',reset:'password-reset-request',confirm:'password-reset-confirm'}[mode];
      if(mode==='confirm')body.token=linkToken;
      const r=await api(action,body);
      if(mode==='login'||mode==='confirm'){if(mode==='confirm')history.replaceState({},'',location.pathname);await dashboard();message('You’re signed in.');}else message(r.message);
    }catch(err){message(err.message);}finally{submitting=false;button.disabled=false;challengeToken='';if(widget!==undefined&&window.turnstile)window.turnstile.reset(widget);}};
  $('logout').onclick=async()=>{try{await api('logout',{});location.href='/account/';}catch(e){message(e.message);}};
  $('copy-code').onclick=async()=>{try{await navigator.clipboard.writeText(current.pie.code);message('Code copied. Apply it at checkout for an eligible pickup order.');}catch{message('Copy the code shown above.');}};
  $('consent-form').onsubmit=async e=>{e.preventDefault();try{await api('consent',{sms:e.target.elements.sms.checked,email:e.target.elements.email.checked,consentText:siteConfig.consentText});message('Preferences saved. New text requests need a YES reply.');}catch(err){message(err.message);}};
  $('delete-form').onsubmit=async e=>{e.preventDefault();if(!confirm('Delete your rewards account and saved addresses?'))return;try{await api('delete',{password:e.target.elements.password.value});location.href='/account/';}catch(err){message(err.message);}};
  $('more-orders').onclick=async()=>{try{const r=await api('orders?page='+(++orderPage));renderOrders(r.orders,true);}catch(err){orderPage--;message(err.message);}};
  window.addEventListener('focus',()=>{if(current)dashboard().catch(()=>{});});
  (async()=>{try{
    siteConfig=await api('config');$('consent-copy').textContent=siteConfig.consentText;$('account-consent-copy').textContent=siteConfig.consentText;
    if(linkToken)setMode('confirm');else{try{await dashboard();return;}catch{setMode(new URLSearchParams(location.search).has('join')?'signup':'login'); try {const draft=JSON.parse(sessionStorage.getItem('gigis_rewards_profile')||'null');if(draft){for(const key of ['name','phone','email','address','city','state'])$('access-form').elements[key].value=draft[key]|| (key==='state'?'NJ':'');sessionStorage.removeItem('gigis_rewards_profile');}}catch{ /* Optional prefill. */ }}}

  }catch(e){message(e.message);$('submit').disabled=true;}})();
})();
