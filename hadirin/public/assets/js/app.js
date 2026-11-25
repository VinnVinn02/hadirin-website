/* Hadirin v0.5 — front-end, data tersimpan di server (Supabase, lewat fungsi RPC) */
(function(){
  'use strict';
  // Diisi otomatis oleh deploy/build-single.js dari supabase/config.json
  const CFG={url:'__SUPABASE_URL__',key:'__SUPABASE_KEY__'};

  const $=id=>document.getElementById(id);
  const pad=n=>String(n).padStart(2,'0');
  const now=new Date();
  const iso=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
  let todayISO=iso(now);
  const fmtDate=s=>{const [y,m,d]=String(s).split('-').map(Number);return new Date(y,m-1,d).toLocaleDateString('id-ID',{day:'numeric',month:'short'});};
  const clock=()=>{const d=new Date();return pad(d.getHours())+'.'+pad(d.getMinutes());};
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const initials=n=>String(n||'?').replace(/,.*$/,'').split(' ').filter(Boolean).map(w=>w[0]).slice(0,2).join('').toUpperCase();
  const short=n=>String(n||'').replace(/,.*$/,'');
  const toast=(m,kind)=>{const t=$('toast');t.textContent=m;t.className='toast'+(kind?' '+kind:'');t.hidden=false;clearTimeout(toast._t);toast._t=setTimeout(()=>t.hidden=true,3400);};
  $('todayLbl').textContent=now.toLocaleDateString('id-ID',{weekday:'long',day:'numeric',month:'long',year:'numeric'});

  /* ---------- Penyimpanan lokal (hanya preferensi & token sesi) ---------- */
  const store={
    get(k,d){try{const v=localStorage.getItem(k);return v?JSON.parse(v):d;}catch(_){return d;}},
    set(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(_){}},
    sget(k){try{const v=sessionStorage.getItem(k);return v?JSON.parse(v):null;}catch(_){return null;}},
    sset(k,v){try{sessionStorage.setItem(k,JSON.stringify(v));}catch(_){}},
    sdel(k){try{sessionStorage.removeItem(k);}catch(_){}}
  };
  const THEME_KEY='hadirin:theme', SESS_KEY='hadirin:sess:v3', LOCKUI_KEY='hadirin:lockui:v3';

  /* ---------- Server ---------- */
  const configured=/^https:\/\//.test(CFG.url)&&CFG.key.length>20;
  let online=true;
  function setSync(ok,msg){
    online=ok;const l=$('syncLbl');if(!l)return;
    l.className='sync'+(ok?'':' off');l.textContent=ok?'● Tersambung · '+clock():'● '+(msg||'Offline');
    l.title=ok?'Data tersimpan di server':'Tidak bisa menghubungi server';
  }
  async function rpc(fn,args){
    if(!configured)throw new Error('Server belum dikonfigurasi.');
    let r;
    try{
      r=await fetch(CFG.url+'/rest/v1/rpc/'+fn,{method:'POST',
        headers:{'Content-Type':'application/json',apikey:CFG.key,Authorization:'Bearer '+CFG.key},
        body:JSON.stringify(args||{})});
    }catch(_){setSync(false);throw new Error('Tidak bisa terhubung ke server. Periksa koneksi internet.');}
    const txt=await r.text();let data=null;try{data=txt?JSON.parse(txt):null;}catch(_){}
    if(!r.ok){
      let m=(data&&data.message)||('Server sedang bermasalah ('+r.status+'). Coba lagi.');
      if(/Could not find the function|PGRST202/i.test(m)||(data&&data.code==='PGRST202'))m='Fitur ini butuh pembaruan database. Admin: jalankan file migrasi terbaru di Supabase → SQL Editor.';
      if(m==='SESI_HABIS'){sessionGone();throw new Error('Sesi berakhir. Silakan masuk lagi.');}
      setSync(true);throw new Error(m);
    }
    setSync(true);return data;
  }
  const authed=(fn,args)=>rpc(fn,Object.assign({p_token:token},args||{}));

  /* ---------- Tema terang / gelap ---------- */
  const THEMES=['auto','light','dark'], THEME_LBL={auto:'Tema: otomatis',light:'Tema: terang',dark:'Tema: gelap'};
  function applyTheme(t){
    if(t==='auto')document.documentElement.removeAttribute('data-theme');else document.documentElement.setAttribute('data-theme',t);
    document.querySelectorAll('[data-theme-btn]').forEach(b=>{b.textContent=t==='dark'?'☾':t==='light'?'☀':'◐';b.title=THEME_LBL[t];b.setAttribute('aria-label',THEME_LBL[t]);});
  }
  let theme=store.get(THEME_KEY,'auto');if(!THEMES.includes(theme))theme='auto';applyTheme(theme);
  document.addEventListener('click',e=>{const b=e.target.closest('[data-theme-btn]');if(!b)return;
    theme=THEMES[(THEMES.indexOf(theme)+1)%THEMES.length];store.set(THEME_KEY,theme);applyTheme(theme);toast(THEME_LBL[theme]);});

  /* ---------- Unduh file (CSV) ---------- */
  function download(name,rows){
    const csv='﻿'+rows.map(r=>r.map(v=>{let s=String(v??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return /[",;\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}).join(';')).join('\r\n');
    saveBlob(new Blob([csv],{type:'text/csv;charset=utf-8'}),name);
  }
  function saveBlob(blob,name,open){
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;if(open){a.target='_blank';a.rel='noopener';}else a.download=name;
    document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  }

  /* ---------- Lampiran: validasi + kompres foto sebelum dikirim ---------- */
  const FILE_MAX=8*1024*1024, PDF_MAX=2*1024*1024;
  function checkFile(f){
    if(!f)return '';
    const ext=(f.name.split('.').pop()||'').toLowerCase();
    if(['heic','heif'].includes(ext)||/hei[cf]/.test(f.type))return 'Format HEIC belum didukung. Atur kamera ke JPG atau kirim tangkapan layar foto surat.';
    const isImg=['image/jpeg','image/png','image/webp'].includes(f.type)||['jpg','jpeg','png','webp'].includes(ext);
    const isPdf=f.type==='application/pdf'||ext==='pdf';
    if(!isImg&&!isPdf)return 'Lampiran harus berupa foto (JPG/PNG/WEBP) atau PDF.';
    if(isPdf&&f.size>PDF_MAX)return 'PDF maksimal 2 MB. Foto surat bisa sampai 8 MB (otomatis dikecilkan).';
    if(f.size>FILE_MAX)return 'Ukuran foto maksimal 8 MB.';
    return '';
  }
  const safeName=n=>String(n||'').replace(/[^\w.\- ()]/g,'_').slice(0,80);
  const b64=buf=>{let s='';const u=new Uint8Array(buf);for(let i=0;i<u.length;i+=0x8000)s+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000));return btoa(s);};
  async function packFile(f){
    if(!f)return null;
    const ext=(f.name.split('.').pop()||'').toLowerCase();
    if(f.type==='application/pdf'||ext==='pdf')return {name:safeName(f.name),mime:'application/pdf',data:b64(await f.arrayBuffer())};
    // Foto dikecilkan ke sisi terpanjang 1600 px (JPEG) supaya cepat terkirim dari HP
    try{
      const bmp=await createImageBitmap(f);const k=Math.min(1,1600/Math.max(bmp.width,bmp.height));
      const c=document.createElement('canvas');c.width=Math.round(bmp.width*k);c.height=Math.round(bmp.height*k);
      const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);g.drawImage(bmp,0,0,c.width,c.height);
      const blob=await new Promise(res=>c.toBlob(res,'image/jpeg',0.82));
      return {name:safeName(f.name.replace(/\.\w+$/,'')+'.jpg'),mime:'image/jpeg',data:b64(await blob.arrayBuffer())};
    }catch(_){throw new Error('Foto tidak bisa dibaca. Coba foto ulang atau pakai format JPG.');}
  }
  // Pratinjau lampiran di dalam halaman: foto langsung tampil, PDF lewat tombol buka/unduh.
  // (Membuka tab baru setelah menunggu server sering diblokir browser sebagai pop-up.)
  let lampBlob=null, lampUrl='', lampName='';
  async function openLampiran(id){
    const dlg=$('lampDialog'), view=$('lampView');
    if(lampUrl){URL.revokeObjectURL(lampUrl);lampUrl='';}
    lampBlob=null;$('lampTitle').textContent='Lampiran';view.innerHTML='<p class="hint">Memuat lampiran…</p>';
    $('lampOpen').disabled=$('lampSave').disabled=true;
    if(!dlg.open)dlg.showModal();
    try{
      const a=await authed('lampiran_get',{p_id:id});
      const bin=atob(a.data),u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);
      lampBlob=new Blob([u],{type:a.mime});lampUrl=URL.createObjectURL(lampBlob);lampName=a.name;
      $('lampTitle').textContent=a.name;
      if(/^image\//.test(a.mime)){const img=new Image();img.src=lampUrl;img.alt='Lampiran '+a.name;view.replaceChildren(img);}
      else view.innerHTML=`<div class="empty"><span class="big">📄</span>File PDF. Tekan <b>Buka di tab baru</b> untuk membaca, atau <b>Unduh</b>.</div>`;
      $('lampOpen').disabled=$('lampSave').disabled=false;
    }catch(e){view.innerHTML=`<p class="err">${esc(e.message)}</p>`;}
  }
  $('lampClose').addEventListener('click',()=>$('lampDialog').close());
  $('lampOpen').addEventListener('click',()=>{if(lampBlob)saveBlob(lampBlob,lampName,true);});
  $('lampSave').addEventListener('click',()=>{if(lampBlob)saveBlob(lampBlob,lampName,false);});

  /* ---------- Akun & peran ---------- */
  const ROLE={admin:'Admin',tu:'TU',guru:'Guru'};
  const demo=[['admin','admin123','admin'],['tu.sari','tu123','tu'],['guru.firman','guru123','guru']];
  const PERMS={lapor:['admin','tu','guru'],kamera:['admin','tu','guru'],verif:['admin','tu'],rekap:['admin','tu'],siswa:['admin','tu'],users:['admin']};
  const TABS=[['lapor','Pelaporan'],['kamera','Kamera kelas'],['verif','Verifikasi surat'],['rekap','Rekap sekolah'],['siswa','Data siswa'],['users','Pengguna']];
  let session=null, token=null, view='lapor';

  function pwProblem(pw,uid){
    if(pw.length<8)return 'Minimal 8 karakter.';
    if(!/[A-Za-z]/.test(pw)||!/\d/.test(pw))return 'Harus berisi huruf dan angka.';
    if(uid&&pw.toLowerCase().includes(uid.toLowerCase()))return 'Jangan memakai ID pengguna di dalam kata sandi.';
    if(/^(password|12345678|qwerty|hadirin)/i.test(pw))return 'Kata sandi terlalu mudah ditebak.';
    return '';
  }

  /* ---------- Login ---------- */
  $('demoList').innerHTML=demo.map(([u,p,r])=>`<button type="button" data-u="${u}" data-p="${p}">${ROLE[r]}: ${u} / ${p}</button>`).join('');
  $('demoList').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
    $('uid').value=b.dataset.u;$('upw').value=b.dataset.p;$('loginErr').hidden=true;$('loginBtn').focus();});
  $('pwToggle').addEventListener('click',e=>{const i=$('upw');const show=i.type==='password';i.type=show?'text':'password';e.target.textContent=show?'Sembunyi':'Lihat';e.target.setAttribute('aria-pressed',show);});

  // Penguncian ditentukan server; browser hanya menampilkan hitung mundurnya
  let lockUntil=store.get(LOCKUI_KEY,0), lockTimer=null;
  function lockTick(){
    const left=Math.ceil((lockUntil-Date.now())/1000);
    if(left<=0){clearInterval(lockTimer);lockTimer=null;$('lockBar').hidden=true;$('loginBtn').disabled=false;return;}
    $('lockBar').hidden=false;$('lockBar').textContent=`Terlalu banyak percobaan gagal. Coba lagi dalam ${left>90?Math.ceil(left/60)+' menit':left+' detik'}.`;$('loginBtn').disabled=true;
  }
  function startLockTimer(){if(!lockTimer){lockTick();lockTimer=setInterval(lockTick,500);}}
  if(Date.now()<lockUntil)startLockTimer();
  let busy=false;
  $('loginForm').addEventListener('submit',async e=>{
    e.preventDefault();
    if(busy||Date.now()<lockUntil)return;
    const err=$('loginErr'), id=$('uid').value.trim().toLowerCase(), pw=$('upw').value;
    const fail=m=>{err.textContent=m;err.hidden=false;};
    if(!id||!pw)return fail('Isi ID pengguna dan kata sandi.');
    if(id.length>40||pw.length>128)return fail('ID atau kata sandi terlalu panjang.');
    busy=true;$('loginBtn').disabled=true;$('loginBtn').textContent='Memeriksa…';
    let res;
    try{res=await rpc('login',{p_uid:id,p_pw:pw});}
    catch(ex){fail(ex.message);return;}
    finally{busy=false;$('loginBtn').disabled=false;$('loginBtn').textContent='Masuk';}
    if(res.wait){lockUntil=Date.now()+res.wait*1000;store.set(LOCKUI_KEY,lockUntil);err.hidden=true;startLockTimer();return;}
    if(!res.ok)return fail(res.msg||'Gagal masuk.');
    err.hidden=true;$('upw').value='';
    token=res.token;session=res.user;store.sset(SESS_KEY,{token,exp:Date.now()+IDLE_MS});
    startSession();
  });

  /* ---------- Sesi: kedaluwarsa otomatis bila tidak aktif ---------- */
  const IDLE_MS=15*60*1000;
  let idleTimer=null, idleWarn=null;
  function touchSession(){
    if(!session)return;
    store.sset(SESS_KEY,{token,exp:Date.now()+IDLE_MS});
    clearTimeout(idleTimer);clearTimeout(idleWarn);
    idleWarn=setTimeout(()=>toast('Sesi akan berakhir 1 menit lagi karena tidak ada aktivitas.','warn'),IDLE_MS-60000);
    idleTimer=setTimeout(()=>doLogout('Sesi berakhir karena tidak ada aktivitas selama 15 menit. Silakan masuk lagi.',true),IDLE_MS);
  }
  let lastTouch=0;
  // Aktivitas pengguna memperpanjang sesi di browser; server memperpanjang sesinya setiap ada permintaan
  ['click','keydown','pointerdown'].forEach(ev=>document.addEventListener(ev,()=>{
    if(session&&Date.now()-lastTouch>60000){lastTouch=Date.now();touchSession();if(!busyRefresh)authed('sesi_cek').catch(()=>{});}
  },{passive:true}));
  function startSession(){
    touchSession();
    if(session.temp)return openPwDialog(true);
    enterApp();
  }
  function sessionGone(){if(session)clearLocal('Sesi berakhir. Silakan masuk lagi.');}
  function doLogout(reason,expired){
    if(!session)return;
    const t=token;rpc('logout',{p_token:t,p_kedaluwarsa:!!expired}).catch(()=>{});
    clearLocal(reason);
  }
  function clearLocal(reason){
    camStop();session=null;token=null;store.sdel(SESS_KEY);clearTimeout(idleTimer);clearTimeout(idleWarn);clearInterval(poller);
    if($('pwDialog').open)$('pwDialog').close();
    clearSelection();resetForm();$('bulkConfirm').hidden=true;$('newPw').hidden=true;$('newPw').innerHTML='';rejecting=null;
    $('appView').hidden=true;$('parentView').hidden=true;$('loginView').hidden=false;$('uid').value='';
    if(reason){$('loginErr').textContent=reason;$('loginErr').hidden=false;}
    $('uid').focus();
  }

  /* ---------- Ganti kata sandi ---------- */
  let pwForced=false;
  function openPwDialog(forced){
    pwForced=!!forced;
    $('pwTitle').textContent=forced?'Buat kata sandi baru':'Ganti kata sandi';
    $('pwLead').textContent=forced?'Akun ini memakai kata sandi sementara. Buat kata sandi baru sebelum melanjutkan.':'Masukkan kata sandi lama dan kata sandi baru.';
    $('pwCancel').hidden=forced;
    $('pwForm').reset();$('pwErr').hidden=true;$('pwMeter').className='meter';$('pwMeterTxt').textContent='';
    $('pwDialog').showModal();$('pwOld').focus();
  }
  function pwStrength(pw){let s=0;if(pw.length>=8)s++;if(pw.length>=12)s++;if(/[a-z]/.test(pw)&&/[A-Z]/.test(pw))s++;if(/\d/.test(pw))s++;if(/[^A-Za-z0-9]/.test(pw))s++;return Math.min(4,s);}
  $('pwNew').addEventListener('input',e=>{const s=pwStrength(e.target.value);$('pwMeter').className='meter s'+s;$('pwMeterTxt').textContent=e.target.value?['Sangat lemah','Lemah','Cukup','Kuat','Sangat kuat'][s]:'';});
  $('pwDialog').addEventListener('cancel',e=>{if(pwForced)e.preventDefault();});
  $('pwCancel').addEventListener('click',()=>$('pwDialog').close());
  $('pwForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const fail=m=>{$('pwErr').textContent=m;$('pwErr').hidden=false;};
    if(!session)return $('pwDialog').close();
    const oldPw=$('pwOld').value, n1=$('pwNew').value, n2=$('pwNew2').value;
    if(!oldPw)return fail('Isi kata sandi saat ini.');
    const p=pwProblem(n1,session.u);if(p)return fail(p);
    if(n1!==n2)return fail('Konfirmasi kata sandi tidak sama.');
    if(n1===oldPw)return fail('Kata sandi baru harus berbeda dari yang lama.');
    try{session=await authed('ganti_sandi',{p_lama:oldPw,p_baru:n1});}catch(ex){return fail(ex.message);}
    $('pwDialog').close();toast('Kata sandi berhasil diganti. Sesi di perangkat lain diputus.','ok');
    if(pwForced){pwForced=false;enterApp();}
  });
  $('pwBtn').addEventListener('click',()=>openPwDialog(false));

  function enterApp(){
    $('loginView').hidden=true;$('parentView').hidden=true;$('appView').hidden=false;
    $('uAv').textContent=initials(session.name);
    $('uName').textContent=session.name;
    $('uRole').textContent=ROLE[session.role];$('uRole').className='pill '+session.role;
    $('uSub').textContent=session.role==='guru'?'Wali kelas '+session.kelas:session.role==='tu'?'Tata Usaha':'Pengelola sistem';
    $('pelapor').value=session.role==='tu'?'Petugas TU':'Orang tua / wali (via telepon)';
    $('logScope').textContent=session.role==='admin'?'Semua aktivitas, termasuk login gagal':'Aktivitas sekolah';
    $('exportLog').hidden=session.role!=='admin';
    $('kelasWrap').hidden=session.role==='guru';$('kelasLbl').hidden=session.role!=='guru';
    kelas=session.role==='guru'?session.kelas:(kelas||'');
    $('loginErr').hidden=true;
    renderTabs();go('lapor');
    clearInterval(poller);poller=setInterval(()=>{if(!document.hidden)refresh(true);},20000);
    toast(`Selamat datang, ${short(session.name)}.`);
  }
  $('logoutBtn').addEventListener('click',()=>doLogout());
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&session)refresh(true);});

  function renderTabs(){
    $('tabs').innerHTML=TABS.filter(([k])=>PERMS[k].includes(session.role)).map(([k,l])=>`<button type="button" data-v="${k}">${l}</button>`).join('');
  }
  $('tabs').addEventListener('click',e=>{const b=e.target.closest('button[data-v]');if(b)go(b.dataset.v);});
  function go(v){
    if(!PERMS[v].includes(session.role))v='lapor';
    if(v!=='kamera')camStop();
    view=v;
    TABS.forEach(([k])=>$('v-'+k).hidden=k!==v);
    document.querySelectorAll('#tabs button').forEach(b=>b.setAttribute('aria-current',b.dataset.v===v?'page':'false'));
    refresh();
  }

  /* ---------- Data dari server ---------- */
  let students=[], hadir=new Set(), reports=[], incoming=[], kelas='', kelasList=[], chart=[], watch=[], log=[];
  let users=[], vitems=[], rrows=[], poller=null, busyRefresh=false, loadedOnce={}, kontak=new Map();
  const byId=id=>students.find(s=>s.id===id)||{id,name:'(siswa)',nis:'-'};
  const LBL={sakit:'Sakit',izin:'Izin',alpa:'Alpa'};

  async function refresh(quiet){
    if(!session||busyRefresh)return;
    busyRefresh=true;
    try{
      const jobs=[authed('log_list').then(r=>{log=r||[];})];
      if(view==='lapor')jobs.push(authed('data_harian',{p_kelas:kelas||null}).then(d=>{
        todayISO=d.hari||todayISO;kelas=d.kelas;kelasList=d.kelasList||[];students=d.siswa||[];hadir=new Set(d.hadir||[]);
        reports=d.reports||[];incoming=d.incoming||[];chart=d.chart||[];watch=d.watch||[];wali=d.wali||'';})
        .then(()=>authed('kontak_ortu',{p_kelas:kelas}).then(r=>{kontak=new Map((r||[]).map(c=>[c.sid,c]));},()=>{kontak=new Map();})));
      if(view==='kamera')jobs.push(authed('data_harian',{p_kelas:kelas||null}).then(d=>{
        todayISO=d.hari||todayISO;kelas=d.kelas;kelasList=d.kelasList||[];students=d.siswa||[];hadir=new Set(d.hadir||[]);
        reports=d.reports||[];incoming=d.incoming||[];}).then(()=>authed('wajah_list',{p_kelas:kelas})).then(r=>{setFaces(r||[]);}));
      if(view==='verif')jobs.push(authed('verif_list').then(r=>{vitems=r||[];}));
      if(view==='rekap')jobs.push(authed('rekap').then(r=>{rrows=(r||[]).sort((a,b)=>a[0].localeCompare(b[0],'id',{numeric:true}));}));
      if(view==='users')jobs.push(authed('users_list').then(r=>{users=r||[];}),rpc('ortu_kelas').then(r=>{kelasAll=r||[];}));
      if(view==='siswa')jobs.push(authed('siswa_list',{p_kelas:sKelas||null}).then(r=>{sdata=r;sKelas=r.kelas;}));
      if(!loadedOnce[view]&&!quiet)showLoading();
      await Promise.all(jobs);
      loadedOnce[view]=true;
      renderAll();
    }catch(e){if(session&&!quiet)toast(e.message,'warn');}
    finally{busyRefresh=false;}
  }
  let wali='';
  function showLoading(){
    const sk='<li class="empty">Memuat data dari server…</li>';
    if(view==='lapor'){$('queue').innerHTML=sk;$('tbody').innerHTML='<tr><td colspan="6"><div class="empty">Memuat…</div></td></tr>';}
    if(view==='verif')$('vbody').innerHTML='<tr><td colspan="6"><div class="empty">Memuat…</div></td></tr>';
    if(view==='rekap')$('rbody').innerHTML='<tr><td colspan="9"><div class="empty">Memuat…</div></td></tr>';
    if(view==='users')$('ubody').innerHTML='<tr><td colspan="6"><div class="empty">Memuat…</div></td></tr>';
    if(view==='siswa')$('sbody').innerHTML='<tr><td colspan="5"><div class="empty">Memuat…</div></td></tr>';
  }
  // Jalankan aksi ke server dengan tombol dinonaktifkan sementara
  async function act(btn,fn){
    if(btn){if(btn.disabled)return;btn.disabled=true;}
    try{return await fn();}catch(e){toast(e.message,'warn');}
    finally{if(btn)btn.disabled=false;}
  }

  /* ---------- Pelaporan ---------- */
  let selected=null, editing=null, filter='all', vfilter='menunggu';
  const templates={
    sakit:['Demam','Sakit perut / diare','Flu dan batuk','Kontrol ke dokter','Rawat inap'],
    izin:['Acara keluarga','Mengikuti lomba','Keperluan mendesak keluarga','Urusan administrasi','Keluarga berduka']
  };
  const covered=sid=>reports.some(r=>r.sid===sid)||incoming.some(r=>r.sid===sid);
  const pending=()=>students.filter(s=>!hadir.has(s.id)&&!covered(s.id));

  $('kelasSel').addEventListener('change',e=>{kelas=e.target.value;clearSelection();resetForm();loadedOnce.lapor=false;refresh();});
  function renderKelasSel(){
    $('kelasLbl').textContent='Kelas '+kelas;
    const sel=$('kelasSel');
    if(sel.options.length!==kelasList.length)sel.innerHTML=kelasList.map(k=>`<option>${esc(k)}</option>`).join('');
    sel.value=kelas;
    if(/^https?:$/.test(location.protocol))$('parentLink').textContent=location.origin+location.pathname+'#lapor?k='+encodeURIComponent(kelas);
  }
  function renderTiles(){
    const c={sakit:0,izin:0,alpa:0};reports.forEach(r=>c[r.jenis]++);
    const p=pending().length;
    const tiles=[
      ['Hadir','var(--hadir)',hadir.size,'dari '+students.length+' siswa, via scan wajah'],
      ['Sakit','var(--sakit)',c.sakit,'laporan masuk'],
      ['Izin','var(--izin)',c.izin,'laporan masuk'],
      ['Alpa','var(--alpa)',c.alpa,'tanpa keterangan'],
      ['Kabar orang tua','var(--brand)',incoming.length,incoming.length?'tinggal diterima':'tidak ada yang menunggu'],
      ['Belum ada kabar','var(--muted)',p,p?'perlu ditindaklanjuti':'semua sudah tercatat']
    ];
    $('tiles').innerHTML=tiles.map(([l,col,n,note])=>`<div class="tile" style="--accent:${col}"><span class="lbl"><i class="dot" style="background:${col}"></i>${l}</span><span class="num">${n}</span><span class="note">${note}</span></div>`).join('');
  }
  const matchQ=(s,q)=>!q||s.name.toLowerCase().includes(q)||String(s.nis).endsWith(q);
  const fileBtn=r=>r.file?(r.lampiran?`<button class="linkbtn" type="button" data-lamp="${esc(r.id)}">📎 ${esc(r.file)}</button>`:`<span class="sub" title="Data contoh: hanya nama file, tidak ada file yang tersimpan">📎 ${esc(r.file)} · contoh, tanpa file</span>`):'';
  function renderQueue(){
    const all=pending(), q=$('qSearch').value.trim().toLowerCase();
    const list=all.filter(s=>matchQ(s,q)), incs=incoming.filter(r=>matchQ(byId(r.sid),q));
    $('bulkAlpa').disabled=!all.length;
    $('acceptAll').hidden=incoming.length<2;
    $('qCount').textContent=all.length+incoming.length?`${incoming.length} kabar orang tua · ${all.length} belum ada kabar`:'';
    const inc=incs.map(r=>{const s=byId(r.sid);const later=r.dari>todayISO;return `<li><div class="inc">
      <span class="av">${initials(s.name)}</span>
      <span style="min-width:0"><span class="qname">${esc(s.name)} <span class="pill ${r.jenis}">${LBL[r.jenis]}</span> <span class="tag">${later?'Mulai '+fmtDate(r.dari):'Baru'}</span></span>
        <span class="qsub">${esc(r.ket)}</span>
        <span class="qsub">${esc(r.pelapor)} · ${esc(r.jam)}${r.file?' · '+fileBtn(r):''}</span></span>
      <span class="incact"><button class="btn small primary" type="button" data-acc="${esc(r.id)}">Terima</button><button class="btn small" type="button" data-chk="${esc(r.id)}">Periksa</button></span>
    </div></li>`;}).join('');
    if(!all.length&&!incoming.length){$('queue').innerHTML='<li class="empty"><span class="big">🎉</span>Semua siswa sudah hadir atau punya keterangan.</li>';return;}
    if(!list.length&&!incs.length){$('queue').innerHTML=`<li class="empty">Tidak ada siswa yang cocok dengan "${esc(q)}".</li>`;return;}
    $('queue').innerHTML=inc+list.map(s=>`<li><button type="button" data-id="${s.id}" aria-pressed="${selected===s.id}">
      <span class="av muted">${initials(s.name)}</span>
      <span style="min-width:0"><span class="qname">${esc(s.name)}</span><span class="qsub">NIS ${esc(s.nis)} · tidak terdeteksi kamera</span></span>
      <span class="pill wait">Belum ada kabar</span></button></li>`).join('');
  }
  const verifPill=v=>v==='disetujui'?'<span class="pill hadir">Disetujui</span>':v==='ditolak'?'<span class="pill sakit">Ditolak</span>':'<span class="pill wait">Menunggu TU</span>';
  function renderTable(){
    const q=$('tSearch').value.trim().toLowerCase();
    const rows=reports.filter(r=>(filter==='all'||r.jenis===filter)&&matchQ(byId(r.sid),q));
    $('exportDay').disabled=!reports.length;
    if(!rows.length){$('tbody').innerHTML=`<tr><td colspan="6"><div class="empty">${q?`Tidak ada laporan yang cocok dengan "${esc(q)}".`:`Belum ada laporan ${filter==='all'?'':LBL[filter]} hari ini.`}</div></td></tr>`;return;}
    $('tbody').innerHTML=rows.map(r=>{const s=byId(r.sid);
      const per=r.dari===r.sampai?fmtDate(r.dari):fmtDate(r.dari)+' – '+fmtDate(r.sampai);
      return `<tr><td><b>${esc(s.name)}</b><div class="sub mono">NIS ${esc(s.nis)}${r.no?' · '+esc(r.no):''}</div></td>
      <td><span class="pill ${r.jenis}">${LBL[r.jenis]}</span></td>
      <td><div class="ket">${esc(r.ket)||'<span class="sub">Tidak ada kabar sampai batas jam lapor</span>'}</div>${r.file?`<div class="sub">Lampiran: ${fileBtn(r)} · ${verifPill(r.verif)}</div>`:''}${r.verif==='ditolak'&&r.alasan?`<div class="sub">Alasan TU: ${esc(r.alasan)}</div>`:''}</td>
      <td class="mono">${per}</td>
      <td><div>${esc(r.pelapor)}</div><div class="sub mono">${esc(r.jam)}${r.oleh?' · '+esc(r.oleh):''}</div></td>
      <td style="white-space:nowrap">${waBtn(r.sid,r.jenis,r.id)} <button class="btn small" type="button" data-edit="${esc(r.id)}">Ubah</button></td></tr>`;}).join('');
  }
  function renderChart(){
    const days=['Sen','Sel','Rab','Kam','Jum'];
    const data=days.map((_,i)=>{const c=chart[i]||{};return [+c.sakit||0,+c.izin||0,+c.alpa||0];});
    const peak=Math.max(...data.map(a=>a[0]+a[1]+a[2]));
    const max=Math.max(6,Math.ceil(peak/2)*2);
    const cols=['var(--sakit)','var(--izin)','var(--alpa)'];
    const W=420,H=200,L=30,R=10,T=14,B=28;
    const y=v=>T+(H-T-B)*(1-v/max);
    let g='';const step=max>12?Math.ceil(max/6/2)*2:2;
    for(let v=0;v<=max;v+=step)g+=`<line x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1"/><text x="${L-8}" y="${y(v)+4}" text-anchor="end">${v}</text>`;
    const bw=(W-L-R)/days.length;
    days.forEach((d,i)=>{let acc=0;const x=L+i*bw+bw*0.25,w=bw*0.5;const isToday=chart[i]&&chart[i].d===todayISO;
      data[i].forEach((v,k)=>{if(!v)return;g+=`<rect x="${x}" y="${y(acc+v)}" width="${w}" height="${Math.max(0,y(acc)-y(acc+v)-1.5)}" rx="3" fill="${cols[k]}"><title>${d}: ${['Sakit','Izin','Alpa'][k]} ${v}</title></rect>`;acc+=v;});
      g+=`<text x="${x+w/2}" y="${y(acc)-5}" text-anchor="middle" style="fill:var(--fg);font-weight:700">${acc}</text><text x="${x+w/2}" y="${H-8}" text-anchor="middle"${isToday?' style="fill:var(--brand);font-weight:700"':''}>${d}</text>`;});
    $('chart').innerHTML=g;
  }
  function renderWatch(){
    if(!watch.length){$('watch').innerHTML='<li class="empty">Belum ada siswa dengan 2 kali atau lebih tidak hadir dalam 30 hari terakhir.</li>';return;}
    $('watch').innerHTML=watch.map(w=>{const parts=[['sakit','Sakit'],['izin','Izin'],['alpa','Alpa']].filter(([k])=>+w[k]>0).map(([k,l])=>`${w[k]}× ${l}`);
      const s=students.find(x=>x.name===w.name);
      return `<li><b>${esc(w.name)}</b><span class="pill ${esc(w.jenis)}">${w.n}× tidak hadir</span><span class="why">${parts.join(', ')} dalam 30 hari terakhir.${+w.alpa>=2?' Pertimbangkan panggilan orang tua.':''}</span>${s?`<span class="why">${waBtn(s.id,'rekap')}</span>`:''}</li>`;}).join('');
  }
  function renderChips(){
    const j=document.querySelector('input[name=jenis]:checked');
    $('chips').innerHTML=j?templates[j.value].map(t=>`<button type="button" class="chip">${t}</button>`).join(''):'<span class="hint">Template keterangan muncul setelah memilih Sakit atau Izin.</span>';
    $('ket').placeholder=j?(j.value==='sakit'?'Contoh: Demam sejak malam, sudah berobat ke klinik.':'Contoh: Menghadiri pernikahan kakak di Medan, kembali Senin.'):'Pilih jenis di atas dulu, lalu tulis keterangan singkat.';
  }
  function resetForm(){
    document.querySelectorAll('input[name=jenis]').forEach(i=>i.checked=false);
    $('ket').value='';$('counter').textContent='0/300';$('dari').value=todayISO;$('sampai').value=todayISO;
    $('file').value='';$('fileName').textContent='Foto surat dokter atau surat orang tua';$('err').hidden=true;
    renderChips();
  }
  function clearSelection(){selected=null;editing=null;$('who').hidden=true;$('formTitle').textContent='Pilih siswa dari antrean';$('saveBtn').textContent='Simpan laporan';}
  // mode: 'baru' | 'ubah' | 'periksa' (laporan orang tua)
  function selectStudent(sid,mode,rec){
    selected=sid;editing=rec||null;const s=byId(sid);
    $('formTitle').textContent=mode==='periksa'?'Periksa laporan dari orang tua':mode==='ubah'?'Ubah laporan':'Laporkan ketidakhadiran';
    $('who').hidden=false;
    $('who').innerHTML=`<span class="av">${initials(s.name)}</span><span style="min-width:0;flex:1"><b>${esc(s.name)}</b><span class="hint">NIS ${esc(s.nis)} · ${esc(kelas)}</span></span>
      <span class="waact" data-k="${rec?esc(rec.jenis):'belum'}" data-r="${rec?esc(rec.id):''}">${waBtn(sid,rec?rec.jenis:'belum',rec&&rec.id)}</span>`;
    resetForm();
    if(rec){
      if(rec.jenis!=='alpa')document.querySelector(`input[name=jenis][value=${rec.jenis}]`).checked=true;
      $('ket').value=rec.ket;$('counter').textContent=rec.ket.length+'/300';$('dari').value=rec.dari;$('sampai').value=rec.sampai;
      if(rec.file)$('fileName').textContent='Tersimpan: '+rec.file;
      renderChips();}
    $('saveBtn').textContent=mode==='periksa'?'Terima laporan':mode==='ubah'?'Simpan perubahan':'Simpan laporan';
    renderQueue();
    if(window.innerWidth<860)$('form').scrollIntoView({behavior:'smooth',block:'start'});
  }
  async function accept(ids,btn){
    const n=await act(btn,()=>authed('terima_laporan',{p_ids:ids}));
    if(n==null)return;
    if(ids.includes(editing&&editing.id))clearSelection();
    toast(n===1?'Laporan orang tua diterima.':`${n} laporan orang tua diterima.`,'ok');refresh(true);
  }
  /* ---------- WhatsApp ke orang tua (wa.me, dikirim manual oleh guru) ---------- */
  const SEKOLAH='SMA Harapan Bangsa';
  // Tombol: jika nomor sudah ada -> "WA ortu"; jika belum -> "Isi no. WA"
  function waBtn(sid,kind,rid){
    const c=kontak.get(sid), has=!!(c&&c.hp);
    return `<button class="btn small${has?' wa':''}" type="button" data-wa="${sid}" data-wak="${esc(kind||'belum')}"${rid?` data-war="${esc(rid)}"`:''}
      title="${has?'Buka WhatsApp dengan pesan yang sudah terisi':'Nomor WA orang tua belum ada'}">${has?'💬 WA ortu':'＋ No. WA'}</button>`
      +(has?` <button class="linkbtn small" type="button" data-hp="${sid}" title="Ubah nomor WA orang tua">ubah no.</button>`:'');
  }
  const salam=()=>{const h=new Date().getHours();return h<11?'Selamat pagi':h<15?'Selamat siang':h<18?'Selamat sore':'Selamat malam';};
  // Jumlah HARI tidak hadir 30 hari terakhir (lebih efektif daripada hanya "hari ini tidak masuk")
  function akumulasi(sid,nama){
    const c=kontak.get(sid)||{}, sk=+c.sakit||0, iz=+c.izin||0, al=+c.alpa||0, n=sk+iz+al;
    if(n<2)return '';
    const parts=[[sk,'sakit'],[iz,'izin'],[al,'tanpa keterangan']].filter(([v])=>v>0).map(([v,l])=>`${v} hari ${l}`);
    return `\n\nSebagai informasi, dalam 30 hari terakhir ${nama} sudah tidak masuk sekolah *${n} hari* (${parts.join(', ')}).`;
  }
  function waPesan(sid,kind,rec){
    const s=byId(sid), nama=s.name, tgl=new Date().toLocaleDateString('id-ID',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
    const dari=session&&session.name?session.name:'Wali kelas';
    const link=/^https?:$/.test(location.protocol)?location.origin+location.pathname+'#lapor?k='+encodeURIComponent(kelas):'';
    const buka=`${salam()} Bapak/Ibu orang tua/wali dari *${nama}* (kelas ${kelas}).`;
    const tutup=`\n\nTerima kasih.\n${dari}\n${SEKOLAH}`;
    const per=rec?(rec.dari===rec.sampai?fmtDate(rec.dari):fmtDate(rec.dari)+' – '+fmtDate(rec.sampai)):'';
    if(kind==='belum')return `${buka}\n\nHingga pukul ${clock()} hari ini (${tgl}), ${nama} belum hadir di sekolah dan kami belum menerima kabar.\n\nJika ${nama} sakit atau izin, mohon kabari kami lewat pesan ini${link?` atau isi formulir berikut:\n${link}`:'.'}`+akumulasi(sid,nama)+tutup;
    if(kind==='alpa')return `${buka}\n\nKami informasikan bahwa ${nama} tercatat *tidak hadir tanpa keterangan (Alpa)* pada ${tgl}.\n\nJika ada alasan yang belum kami terima, mohon kabari kami lewat pesan ini${link?` atau isi formulir:\n${link}`:'.'}`+akumulasi(sid,nama)+tutup;
    if(kind==='sakit'||kind==='izin')return `${buka}\n\nLaporan *${LBL[kind]}* untuk ${nama}${per?` (${per})`:''} sudah kami terima dan dicatat${rec&&rec.no?` dengan nomor ${rec.no}`:''}.${kind==='sakit'?` Semoga ${nama} lekas sembuh.`:''}`+akumulasi(sid,nama)+tutup;
    // 'rekap': ringkasan kehadiran
    const ak=akumulasi(sid,nama);
    return `${buka}\n\nKami ingin berbagi catatan kehadiran ${nama}.`+(ak?ak.replace(/^\n\nSebagai informasi, dalam/,' Dalam'):` Dalam 30 hari terakhir ${nama} jarang tidak masuk.`)
      +`\n\nKehadiran rutin sangat membantu ${nama} mengikuti pelajaran. Jika ada kendala, kami terbuka untuk berdiskusi.`+tutup;
  }
  function waBuka(sid,kind,rid){
    const c=kontak.get(sid);if(!c||!c.hp)return hpEdit(sid,{kind,rid});
    const rec=rid?reports.find(r=>r.id===rid)||incoming.find(r=>r.id===rid):null;
    const url='https://wa.me/'+c.hp+'?text='+encodeURIComponent(waPesan(sid,kind,rec));
    const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener noreferrer';
    document.body.appendChild(a);a.click();a.remove();
    authed('wa_catat',{p_sid:sid,p_jenis:kind}).catch(()=>{});
  }
  // Dialog nomor WA
  let hpSid=null, hpNext=null;
  function hpEdit(sid,next){
    hpSid=sid;hpNext=next||null;const s=byId(sid), c=kontak.get(sid);
    $('hpLead').textContent=`Orang tua/wali dari ${s.name} (NIS ${s.nis}).`;
    $('hpInput').value=c&&c.hp?'0'+c.hp.slice(2):'';$('hpClear').hidden=!(c&&c.hp);
    $('hpErr').hidden=true;$('hpSave').textContent=hpNext?'Simpan & buka WA':'Simpan';
    $('hpDialog').showModal();$('hpInput').focus();
  }
  async function hpSave(val,btn){
    const sid=hpSid, next=hpNext;
    try{
      if(btn)btn.disabled=true;
      const hp=await authed('hp_ortu_set',{p_sid:sid,p_hp:val});
      const c=kontak.get(sid)||{sid,sakit:0,izin:0,alpa:0};kontak.set(sid,Object.assign({},c,{hp}));
      $('hpDialog').close();toast(hp?'Nomor WA orang tua disimpan.':'Nomor WA orang tua dihapus.','ok');
      renderAll();
      const wa=$('who').querySelector('.waact');if(wa&&selected===sid)wa.innerHTML=waBtn(sid,wa.dataset.k,wa.dataset.r||null);
      if(hp&&next)waBuka(sid,next.kind,next.rid);
    }catch(e){$('hpErr').textContent=e.message;$('hpErr').hidden=false;}
    finally{if(btn)btn.disabled=false;}
  }
  $('hpForm').addEventListener('submit',e=>{e.preventDefault();const v=$('hpInput').value.trim();
    if(!v){$('hpErr').textContent='Isi nomor WhatsApp dulu.';$('hpErr').hidden=false;return;}
    hpSave(v,$('hpSave'));});
  $('hpClear').addEventListener('click',e=>hpSave('',e.currentTarget));
  $('hpCancel').addEventListener('click',()=>$('hpDialog').close());
  // Satu penangan klik untuk semua tombol WA (antrean, tabel, form, daftar perhatian)
  document.addEventListener('click',e=>{
    const w=e.target.closest('button[data-wa]');if(w){e.preventDefault();return waBuka(+w.dataset.wa,w.dataset.wak,w.dataset.war||null);}
    const h=e.target.closest('button[data-hp]');if(h){e.preventDefault();return hpEdit(+h.dataset.hp);}
  });

  $('queue').addEventListener('click',e=>{
    const l=e.target.closest('button[data-lamp]');if(l)return openLampiran(l.dataset.lamp);
    const a=e.target.closest('button[data-acc]');if(a)return accept([a.dataset.acc],a);
    const c=e.target.closest('button[data-chk]');if(c){const r=incoming.find(x=>x.id===c.dataset.chk);if(r)selectStudent(r.sid,'periksa',r);return;}
    const b=e.target.closest('button[data-id]');if(b)selectStudent(+b.dataset.id,'baru');});
  $('acceptAll').addEventListener('click',e=>accept(incoming.map(r=>r.id),e.currentTarget));
  $('copyLink').addEventListener('click',()=>{const t=$('parentLink').textContent;
    const ok=()=>toast('Link form orang tua disalin. Bagikan di grup WA kelas.');
    try{navigator.clipboard.writeText(t).then(ok,()=>selectText());}catch(_){selectText();}
    function selectText(){const r=document.createRange();r.selectNodeContents($('parentLink'));const s=getSelection();s.removeAllRanges();s.addRange(r);toast('Teks link sudah dipilih. Salin dengan Ctrl+C.');}});
  $('tbody').addEventListener('click',e=>{
    const l=e.target.closest('button[data-lamp]');if(l)return openLampiran(l.dataset.lamp);
    const b=e.target.closest('button[data-edit]');if(!b)return;const r=reports.find(x=>x.id===b.dataset.edit);if(r)selectStudent(r.sid,'ubah',r);});
  document.querySelectorAll('input[name=jenis]').forEach(i=>i.addEventListener('change',renderChips));
  $('chips').addEventListener('click',e=>{const c=e.target.closest('.chip');if(!c)return;const t=$('ket');t.value=t.value?t.value.replace(/[\s.]*$/,'')+'. '+c.textContent:c.textContent;t.dispatchEvent(new Event('input'));t.focus();});
  $('ket').addEventListener('input',e=>$('counter').textContent=e.target.value.length+'/300');
  $('file').addEventListener('change',e=>{const f=e.target.files[0],bad=checkFile(f);
    if(bad){e.target.value='';$('err').textContent=bad;$('err').hidden=false;$('fileName').textContent='Foto surat dokter atau surat orang tua';return;}
    $('err').hidden=true;
    $('fileName').textContent=f?safeName(f.name)+' ('+Math.max(1,Math.round(f.size/1024))+' KB)':'Foto surat dokter atau surat orang tua';});
  $('resetBtn').addEventListener('click',resetForm);

  $('form').addEventListener('submit',async e=>{
    e.preventDefault();
    const err=$('err'), j=document.querySelector('input[name=jenis]:checked'), ket=$('ket').value.trim();
    const fail=m=>{err.textContent=m;err.hidden=false;};
    if(!selected)return fail('Pilih siswa dari antrean di sebelah kiri terlebih dahulu.');
    if(!j)return fail('Pilih Sakit atau Izin.');
    if(ket.length<5)return fail('Tulis keterangan minimal 5 karakter supaya alasannya jelas.');
    if(!$('dari').value||!$('sampai').value||$('sampai').value<$('dari').value)return fail('Tanggal selesai tidak boleh lebih awal dari tanggal mulai.');
    const days=(new Date($('sampai').value)-new Date($('dari').value))/864e5+1;
    const f=$('file').files[0], fbad=checkFile(f);if(fbad)return fail(fbad);
    if(j.value==='sakit'&&days>2&&!f&&!(editing&&editing.file))return fail('Sakit lebih dari 2 hari wajib melampirkan surat dokter.');
    err.hidden=true;
    const btn=$('saveBtn'), label=btn.textContent;btn.textContent='Menyimpan…';
    const s=byId(selected);
    const ok=await act(btn,async()=>{
      const file=await packFile(f);
      return authed('simpan_laporan',{p:{id:editing?editing.id:null,sid:selected,jenis:j.value,ket,dari:$('dari').value,sampai:$('sampai').value,
        pelapor:$('pelapor').value,notif:$('notif').checked,file}});
    });
    btn.textContent=label;
    if(!ok)return;
    toast(`${s.name} tercatat ${LBL[j.value]}.`,'ok');
    clearSelection();resetForm();refresh(true);
  });

  $('bulkAlpa').addEventListener('click',()=>{const n=pending().length;if(!n)return;$('bulkMsg').textContent=`Tandai ${n} siswa tanpa kabar sebagai Alpa?`;$('bulkConfirm').hidden=false;});
  $('bulkNo').addEventListener('click',()=>$('bulkConfirm').hidden=true);
  $('bulkYes').addEventListener('click',async e=>{
    const n=await act(e.currentTarget,()=>authed('tandai_alpa',{p_kelas:kelas}));
    $('bulkConfirm').hidden=true;if(n==null)return;
    if(selected&&!editing)clearSelection();
    toast(`${n} siswa ditandai Alpa. Masih bisa diubah lewat tabel.`);refresh(true);
  });
  $('filters').addEventListener('click',e=>{const b=e.target.closest('button[data-f]');if(!b)return;filter=b.dataset.f;
    document.querySelectorAll('#filters button').forEach(x=>x.setAttribute('aria-pressed',x===b));renderTable();});

  /* ---------- Verifikasi surat ---------- */
  let rejecting=null;
  function renderVerif(){
    const n=vitems.filter(i=>i.verif==='menunggu').length;
    $('verifCount').textContent=n?`${n} surat menunggu verifikasi`:'Semua surat sudah diverifikasi';
    const rows=vitems.filter(i=>i.verif===vfilter);
    if(!rows.length){$('vbody').innerHTML=`<tr><td colspan="6"><div class="empty">Tidak ada surat dengan status ini.</div></td></tr>`;return;}
    $('vbody').innerHTML=rows.map(i=>{
      let act='';
      if(i.verif==='menunggu'){
        act=rejecting===i.id
          ?`<div style="display:flex;flex-direction:column;gap:6px;min-width:200px"><input type="text" id="rejReason" maxlength="200" placeholder="Alasan penolakan"><span style="display:flex;gap:6px"><button class="btn small" type="button" data-cancel>Batal</button><button class="btn small danger" type="button" data-rejyes="${esc(i.id)}">Tolak</button></span></div>`
          :`<span style="display:flex;gap:6px"><button class="btn small primary" type="button" data-ok="${esc(i.id)}">Setujui</button><button class="btn small danger" type="button" data-rej="${esc(i.id)}">Tolak</button></span>`;
      } else act=`<span class="sub">${i.verif==='ditolak'&&i.alasan?esc(i.alasan):'Oleh TU'}</span>`;
      return `<tr><td><b>${esc(i.name)}</b><div class="sub">${esc(i.kelas)}</div></td>
        <td><span class="pill ${esc(i.jenis)}">${LBL[i.jenis]}</span></td>
        <td><div class="ket">${esc(i.ket)}</div></td>
        <td class="mono">${fileBtn(i)}</td>
        <td class="mono">${esc(i.jam)}</td>
        <td>${act}</td></tr>`;}).join('');
    if(rejecting!==null&&$('rejReason'))$('rejReason').focus();
  }
  $('vbody').addEventListener('click',async e=>{
    const b=e.target.closest('button');if(!b)return;
    if(b.dataset.lamp)return openLampiran(b.dataset.lamp);
    const it=id=>vitems.find(x=>x.id===id);
    if(b.dataset.ok){const i=it(b.dataset.ok);const r=await act(b,()=>authed('verif_set',{p_id:i.id,p_status:'disetujui'}).then(()=>true));
      if(r){toast(`Surat ${i.name} disetujui.`,'ok');rejecting=null;refresh(true);}}
    else if(b.dataset.rej){rejecting=b.dataset.rej;renderVerif();}
    else if(b.dataset.cancel!==undefined){rejecting=null;renderVerif();}
    else if(b.dataset.rejyes){const reason=$('rejReason').value.trim();if(reason.length<5){$('rejReason').placeholder='Tulis alasan, minimal 5 karakter';$('rejReason').focus();return;}
      const i=it(b.dataset.rejyes);const r=await act(b,()=>authed('verif_set',{p_id:i.id,p_status:'ditolak',p_alasan:reason}).then(()=>true));
      if(r){toast(`Surat ${i.name} ditolak. Wali kelas dan orang tua bisa melihat alasannya.`);rejecting=null;refresh(true);}}
  });
  $('vfilters').addEventListener('click',e=>{const b=e.target.closest('button[data-v]');if(!b)return;vfilter=b.dataset.v;rejecting=null;
    document.querySelectorAll('#vfilters button').forEach(x=>x.setAttribute('aria-pressed',x===b));renderVerif();});

  /* ---------- Rekap sekolah ---------- */
  function renderRekap(){
    const rows=rrows;
    if(!rows.length){$('rbody').innerHTML='<tr><td colspan="9"><div class="empty">Belum ada data.</div></td></tr>';$('rtiles').innerHTML='';return;}
    const tot=rows.reduce((a,r)=>{for(let i=2;i<8;i++)a[i]=(a[i]||0)+r[i];return a;},[]);
    const pct=tot[2]?Math.round(tot[3]/tot[2]*100):0;
    $('rtiles').innerHTML=[
      ['Kehadiran sekolah','var(--hadir)',pct+'%',tot[3]+' dari '+tot[2]+' siswa'],
      ['Sakit','var(--sakit)',tot[4],'semua kelas'],
      ['Izin','var(--izin)',tot[5],'semua kelas'],
      ['Alpa','var(--alpa)',tot[6],'semua kelas'],
      ['Belum lapor','var(--muted)',tot[7],rows.filter(r=>r[7]>0).length+' kelas belum lengkap']
    ].map(([l,col,n,note])=>`<div class="tile" style="--accent:${col}"><span class="lbl"><i class="dot" style="background:${col}"></i>${l}</span><span class="num">${n}</span><span class="note">${note}</span></div>`).join('');
    $('rbody').innerHTML=rows.map(r=>{const p=r[2]?Math.round(r[3]/r[2]*100):0;
      return `<tr><td><b>${esc(r[0])}</b></td><td>${esc(r[1])}</td><td class="num">${r[2]}</td><td class="num">${r[3]}</td><td class="num">${r[4]}</td><td class="num">${r[5]}</td><td class="num">${r[6]}</td>
      <td class="num">${r[7]?`<span class="pill ${r[7]>=5?'sakit':'wait'}">${r[7]}</span>`:'0'}</td>
      <td><div style="display:flex;gap:8px;align-items:center"><div class="bar" style="flex:1"><i style="width:${p}%"></i></div><span class="mono">${p}%</span></div></td></tr>`;}).join('');
  }
  $('remindBtn').addEventListener('click',async e=>{
    const n=await act(e.currentTarget,()=>authed('kirim_pengingat'));if(n==null)return;
    toast(n?`Pengingat dicatat untuk ${n} wali kelas.`:'Semua kelas sudah lengkap.');refresh(true);});

  /* ---------- Pengguna (Admin) ---------- */
  let kelasAll=[];
  $('nRole').addEventListener('change',e=>{$('nKelas').disabled=e.target.value!=='guru';if(e.target.value!=='guru')$('nKelas').value='';});
  function renderUsers(){
    const nk=$('nKelas'), cur=nk.value;
    nk.innerHTML='<option value="">Bukan wali kelas</option>'+kelasAll.map(k=>`<option>${esc(k)}</option>`).join('');
    if(kelasAll.includes(cur))nk.value=cur;
    $('ubody').innerHTML=users.map(u=>`<tr>
      <td><b>${esc(u.name)}</b><div class="sub mono">${esc(u.u)}</div></td>
      <td><span class="pill ${esc(u.role)}">${ROLE[u.role]}</span></td>
      <td>${u.kelas?esc(u.kelas):'<span class="sub">–</span>'}</td>
      <td>${u.active?'<span class="pill hadir">Aktif</span>':'<span class="pill wait">Nonaktif</span>'}${u.temp?'<div class="sub">Wajib ganti sandi</div>':u.nopw?'<div class="sub">Belum punya sandi</div>':''}</td>
      <td class="mono">${esc(u.last)}</td>
      <td style="white-space:nowrap">${session&&u.u===session.u?'<span class="sub">Akun Anda</span>':`<span style="display:flex;gap:6px"><button class="btn small" type="button" data-tog="${esc(u.u)}">${u.active?'Nonaktifkan':'Aktifkan'}</button><button class="btn small" type="button" data-rpw="${esc(u.u)}">${u.nopw?'Buat sandi':'Reset sandi'}</button></span>`}</td></tr>`).join('');
    const rowsP=[
      ['Melaporkan siswa sakit/izin',1,1,1],
      ['Menandai Alpa sekaligus',1,1,1],
      ['Melihat data kelas sendiri',1,1,1],
      ['Melihat data semua kelas',1,1,0],
      ['Verifikasi surat izin/sakit',1,1,0],
      ['Rekap semua kelas',1,1,0],
      ['Mengirim pengingat ke wali kelas',1,1,0],
      ['Kelola akun dan peran',1,0,0],
      ['Melihat login gagal di log audit',1,0,0]
    ];
    $('pbody').innerHTML=rowsP.map(([f,...a])=>`<tr><td>${f}</td>${a.map(v=>`<td>${v?'<span class="check">✓ Bisa</span>':'<span class="cross">–</span>'}</td>`).join('')}</tr>`).join('');
  }
  $('ubody').addEventListener('click',async e=>{
    const r=e.target.closest('button[data-rpw]');
    if(r){const uid=r.dataset.rpw;if(!confirm(`Buat kata sandi sementara baru untuk ${uid}? Kata sandi lama langsung tidak berlaku dan sesi akun itu diputus.`))return;
      const temp=await act(r,()=>authed('user_reset',{p_uid:uid}));if(!temp)return;
      $('newPw').hidden=false;$('newPw').innerHTML=`Kata sandi sementara untuk <b>${esc(uid)}</b>: <span class="mono"><b>${esc(temp)}</b></span><br><span class="hint">Hanya ditampilkan sekali. Sampaikan langsung ke pemilik akun, jangan lewat grup.</span>`;
      toast(`Kata sandi ${uid} direset.`,'ok');refresh(true);return;}
    const b=e.target.closest('button[data-tog]');if(!b)return;
    const res=await act(b,()=>authed('user_toggle',{p_uid:b.dataset.tog}));if(res==null)return;
    toast(`Akun ${b.dataset.tog} ${res?'diaktifkan':'dinonaktifkan'}.`);refresh(true);});
  $('userForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const name=$('nName').value.trim(), u=$('nUser').value.trim().toLowerCase(), role=$('nRole').value, k=role==='guru'?$('nKelas').value:'';
    const fail=m=>{$('uErr').textContent=m;$('uErr').hidden=false;$('newPw').hidden=true;};
    if(name.length<3)return fail('Isi nama lengkap.');
    if(!/^[a-z0-9._]{3,30}$/.test(u))return fail('ID pengguna 3–30 karakter: huruf kecil, angka, titik, atau garis bawah.');
    if(role==='guru'&&!k)return fail('Pilih kelas untuk wali kelas.');
    $('uErr').hidden=true;
    let res;try{res=await authed('user_buat',{p_nama:name,p_uid:u,p_role:role,p_kelas:k});}catch(ex){return fail(ex.message);}
    $('newPw').hidden=false;$('newPw').innerHTML=`Akun <b>${esc(res.u)}</b> dibuat. Kata sandi sementara: <span class="mono"><b>${esc(res.temp)}</b></span><br><span class="hint">Hanya ditampilkan sekali. Pengguna wajib menggantinya saat login pertama.</span>`;
    $('nName').value='';$('nUser').value='';refresh(true);
  });

  /* ---------- Data siswa & kelas (Admin + TU) ---------- */
  let sdata=null, sKelas='', sEdit=null, impRows=[], impHeader=0;
  const hpTampil=h=>h?('0'+String(h).slice(2)).replace(/(\d{4})(\d{4})(\d+)/,'$1 $2 $3'):'';
  function renderSiswa(){
    if(!sdata)return;
    const kl=sdata.kelasList||[], q=$('sCari').value.trim().toLowerCase();
    $('sTotal').textContent=`${sdata.total} siswa`;$('sKelasN').textContent=`${kl.length} kelas`;
    const opts=kl.map(k=>`<option value="${esc(k.id)}">${esc(k.id)} (${k.n})</option>`).join('');
    $('sKelas').innerHTML=opts;$('sKelas').value=sKelas;
    const fk=$('sfKelas').value;$('sfKelas').innerHTML=kl.map(k=>`<option value="${esc(k.id)}">${esc(k.id)}</option>`).join('');
    $('sfKelas').value=sEdit?sEdit.kelas:(kl.some(k=>k.id===fk)?fk:sKelas);
    const list=(sdata.siswa||[]).filter(s=>!q||s.name.toLowerCase().includes(q)||s.nis.toLowerCase().includes(q));
    $('sbody').innerHTML=list.length?list.map(s=>`<tr>
      <td class="mono">${esc(s.nis)}</td><td><b>${esc(s.name)}</b></td>
      <td class="mono">${s.hp?esc(hpTampil(s.hp)):'<span class="sub">–</span>'}</td>
      <td>${s.wajah?'<span class="pill hadir">Terdaftar</span>':'<span class="pill wait">Belum</span>'}</td>
      <td style="white-space:nowrap"><span style="display:flex;gap:6px"><button class="btn small" type="button" data-sedit="${s.id}">Ubah</button><button class="btn small danger" type="button" data-sdel="${s.id}">Hapus</button></span></td></tr>`).join('')
      :`<tr><td colspan="5"><div class="empty">${q?'Tidak ada siswa yang cocok.':'Belum ada siswa di kelas ini. Tambahkan lewat form atau impor dari Excel.'}</div></td></tr>`;
    $('kbody').innerHTML=kl.map(k=>`<tr><td><b>${esc(k.id)}</b></td>
      <td>${k.wali?esc(k.wali):'<span class="sub">–</span>'}${k.guru?`<div class="sub">Akun: ${esc(k.guru)}</div>`:''}</td>
      <td class="num">${k.n}</td>
      <td style="white-space:nowrap"><span style="display:flex;gap:6px;justify-content:flex-end"><button class="btn small" type="button" data-kwali="${esc(k.id)}">Ubah wali</button>${k.n||k.guru?'':`<button class="btn small danger" type="button" data-kdel="${esc(k.id)}">Hapus</button>`}</span></td></tr>`).join('');
    const isAdmin=session&&session.role==='admin';
    $('demoPanel').hidden=!isAdmin;$('sDemo').hidden=!sdata.demo;$('sDemo').textContent='Data contoh harian: aktif';
    $('demoText').innerHTML=sdata.demo
      ?'<b>Aktif.</b> Setiap hari server mengisi kehadiran dan laporan contoh secara otomatis, jadi sebagian besar siswa langsung tercatat hadir sebelum discan. Matikan saat sekolah mulai memakai Hadirin sungguhan.'
      :'<b>Mati.</b> Kehadiran hanya tercatat dari scan wajah dan input guru. Laporan contoh tidak dibuat lagi.';
    $('demoToggle').textContent=sdata.demo?'Matikan data contoh':'Nyalakan data contoh';
    $('demoToggle').className='btn '+(sdata.demo?'danger':'');
  }
  function resetSiswaForm(){
    sEdit=null;$('sfNis').value='';$('sfNama').value='';$('sfHp').value='';$('sfErr').hidden=true;
    $('sfEyebrow').textContent='Siswa baru';$('sfTitle').textContent='Tambah siswa';$('sfBatal').hidden=true;$('sfSimpan').textContent='Simpan siswa';
    $('sfKelas').value=sKelas;
  }
  $('sKelas').addEventListener('change',e=>{sKelas=e.target.value;$('sCari').value='';if(!sEdit)$('sfKelas').value=sKelas;refresh();});
  $('sCari').addEventListener('input',renderSiswa);
  $('sfBatal').addEventListener('click',resetSiswaForm);
  $('sbody').addEventListener('click',async e=>{
    const b=e.target.closest('button');if(!b||!sdata)return;
    const s=(sdata.siswa||[]).find(x=>String(x.id)===(b.dataset.sedit||b.dataset.sdel));if(!s)return;
    if(b.dataset.sedit){sEdit=s;$('sfNis').value=s.nis;$('sfNama').value=s.name;$('sfKelas').value=s.kelas;$('sfHp').value=hpTampil(s.hp);
      $('sfEyebrow').textContent='Ubah data';$('sfTitle').textContent=s.name;$('sfBatal').hidden=false;$('sfSimpan').textContent='Simpan perubahan';$('sfErr').hidden=true;
      $('siswaForm').scrollIntoView({behavior:'smooth',block:'center'});$('sfNama').focus({preventScroll:true});return;}
    if(!confirm(`Hapus ${s.name} (NIS ${s.nis})?\n\nSemua laporan, lampiran, data wajah, dan riwayat kehadiran siswa ini ikut terhapus dan tidak bisa dikembalikan.`))return;
    const ok=await act(b,()=>authed('siswa_hapus',{p_id:s.id}).then(()=>true));
    if(ok){if(sEdit&&sEdit.id===s.id)resetSiswaForm();toast(`${s.name} dihapus.`);refresh(true);}
  });
  $('siswaForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const fail=m=>{$('sfErr').textContent=m;$('sfErr').hidden=false;};
    const nis=$('sfNis').value.trim(), nama=$('sfNama').value.trim(), k=$('sfKelas').value, hp=$('sfHp').value.trim();
    if(nis.length<3)return fail('Isi NIS (minimal 3 karakter).');
    if(nama.length<2)return fail('Isi nama lengkap siswa.');
    if(!k)return fail('Pilih kelas. Kalau belum ada, tambahkan kelasnya dulu di daftar kelas.');
    $('sfErr').hidden=true;
    const r=await act($('sfSimpan'),()=>authed('siswa_simpan',{p_id:sEdit?sEdit.id:null,p_nis:nis,p_nama:nama,p_kelas:k,p_hp:hp||null}).catch(ex=>{fail(ex.message);return null;}));
    if(!r)return;
    toast(sEdit?`Data ${r.name} disimpan.`:`${r.name} ditambahkan ke ${r.kelas}.`,'ok');
    sKelas=r.kelas;resetSiswaForm();refresh(true);
  });

  // ---- Impor CSV (dari Excel). Pemisah ; atau , dideteksi otomatis.
  function parseCSV(text){
    text=text.replace(/^\uFEFF/,'');
    const first=text.split(/\r?\n/)[0]||'';
    const sep=(first.match(/;/g)||[]).length>(first.match(/,/g)||[]).length?';':(first.includes('\t')&&!first.includes(',')?'\t':',');
    const rows=[];let row=[],f='',q=false;
    for(let i=0;i<text.length;i++){const c=text[i];
      if(q){if(c==='"'){if(text[i+1]==='"'){f+='"';i++;}else q=false;}else f+=c;}
      else if(c==='"')q=true;
      else if(c===sep){row.push(f);f='';}
      else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(f);rows.push(row);row=[];f='';}
      else f+=c;}
    if(f!==''||row.length){row.push(f);rows.push(row);}
    return rows.filter(r=>r.some(c=>c.trim()!==''));
  }
  function csvToSiswa(rows){
    if(!rows.length)return [];
    const h=rows[0].map(c=>c.trim().toLowerCase());
    const find=re=>h.findIndex(c=>re.test(c));
    let iN=find(/^nis\b|induk/), iNm=find(/^nama/), iK=find(/^kelas|rombel/), iH=find(/wa|hp|telep|telp|no\.? ?(ortu|orang)/);
    let data=rows;
    impHeader=0;
    if(iN>=0&&iNm>=0&&iK>=0){data=rows.slice(1);impHeader=1;}else{iN=0;iNm=1;iK=2;iH=3;}
    return data.map(r=>({nis:(r[iN]||'').trim(),nama:(r[iNm]||'').trim(),kelas:(r[iK]||'').trim(),hp:iH>=0?(r[iH]||'').trim():''}));
  }
  $('impTemplate').addEventListener('click',()=>{
    const csv='\uFEFFNIS;Nama;Kelas;No WA Ortu\r\n2301101;Contoh Nama Siswa;XI IPA 1;081234567890\r\n';
    saveBlob(new Blob([csv],{type:'text/csv;charset=utf-8'}),'template-data-siswa.csv',false);
  });
  $('impFile').addEventListener('change',async e=>{
    const f=e.target.files[0];impRows=[];$('impErr').hidden=true;$('impHasil').hidden=true;$('impInfo').hidden=true;$('impKirim').disabled=true;
    if(!f)return;
    if(f.size>2e6){$('impErr').textContent='File terlalu besar (maks 2 MB).';$('impErr').hidden=false;return;}
    if(/\.xlsx?$/i.test(f.name)){$('impErr').textContent='File Excel (.xlsx) belum bisa dibaca langsung. Di Excel pilih File → Save As → CSV, lalu pilih file CSV-nya.';$('impErr').hidden=false;return;}
    try{impRows=csvToSiswa(parseCSV(await f.text()));}catch(_){impRows=[];}
    if(!impRows.length){$('impErr').textContent='Tidak ada baris data yang terbaca. Pastikan kolomnya NIS, Nama, Kelas.';$('impErr').hidden=false;return;}
    if(impRows.length>3000){$('impErr').textContent=`Ada ${impRows.length} baris. Maksimal 3000 sekali impor, pecah file menjadi beberapa bagian.`;$('impErr').hidden=false;impRows=[];return;}
    const kls=new Set(impRows.map(r=>r.kelas.toLowerCase()).filter(Boolean));
    $('impInfo').innerHTML=`Terbaca <b>${impRows.length}</b> siswa di <b>${kls.size}</b> kelas. Contoh baris pertama: <span class="mono">${esc(impRows[0].nis)} · ${esc(impRows[0].nama)} · ${esc(impRows[0].kelas)}</span>`;
    $('impInfo').hidden=false;$('impKirim').disabled=false;
  });
  $('impKirim').addEventListener('click',async e=>{
    if(!impRows.length)return;
    const r=await act(e.currentTarget,()=>authed('siswa_impor',{p_rows:impRows,p_buat_kelas:$('impBuatKelas').checked}).catch(ex=>{$('impErr').textContent=ex.message;$('impErr').hidden=false;return null;}));
    if(!r)return;
    const skip=(r.dilewati||[]).map(x=>`<li>Baris ${x.baris+impHeader}${x.nis?' (NIS '+esc(x.nis)+')':''}: ${esc(x.alasan)}</li>`).join('');
    $('impHasil').innerHTML=`Selesai: <b>${r.baru}</b> siswa baru, <b>${r.diubah}</b> diperbarui${r.kelasBaru?`, <b>${r.kelasBaru}</b> kelas baru`:''}.`
      +(r.jumlahDilewati?`<br><b>${r.jumlahDilewati}</b> baris dilewati${r.jumlahDilewati>50?' (50 pertama ditampilkan)':''}:<ul class="imp-skip">${skip}</ul>`:'');
    $('impHasil').hidden=false;$('impErr').hidden=true;$('impFile').value='';impRows=[];$('impKirim').disabled=true;$('impInfo').hidden=true;
    toast('Impor data siswa selesai.','ok');refresh(true);
  });

  // ---- Kelas
  $('kelasForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const nama=$('kfNama').value.trim(), wali=$('kfWali').value.trim();
    const fail=m=>{$('kfErr').textContent=m;$('kfErr').hidden=false;};
    if(!nama)return fail('Isi nama kelas, misalnya X-2 atau XI IPA 3.');
    $('kfErr').hidden=true;
    const ok=await act(e.submitter,()=>authed('kelas_simpan',{p_id:nama,p_wali:wali,p_baru:true}).then(()=>true).catch(ex=>{fail(ex.message);return false;}));
    if(!ok)return;
    toast(`Kelas ${nama} ditambahkan.`,'ok');$('kfNama').value='';$('kfWali').value='';sKelas=nama;refresh(true);
  });
  $('kbody').addEventListener('click',async e=>{
    const b=e.target.closest('button');if(!b||!sdata)return;
    if(b.dataset.kwali){const k=sdata.kelasList.find(x=>x.id===b.dataset.kwali);
      const w=prompt(`Nama wali kelas ${k.id}:`,k.wali||'');if(w===null)return;
      const ok=await act(b,()=>authed('kelas_simpan',{p_id:k.id,p_wali:w,p_baru:false}).then(()=>true));
      if(ok){toast(`Wali kelas ${k.id} disimpan.`,'ok');refresh(true);}return;}
    if(b.dataset.kdel){const id=b.dataset.kdel;if(!confirm(`Hapus kelas ${id}? Kelas ini sudah kosong.`))return;
      const ok=await act(b,()=>authed('kelas_hapus',{p_id:id}).then(()=>true));
      if(ok){if(sKelas===id)sKelas='';toast(`Kelas ${id} dihapus.`);refresh(true);}}
  });

  // ---- Saklar data contoh (Admin)
  $('demoToggle').addEventListener('click',async e=>{
    if(!sdata)return;
    const nyalakan=!sdata.demo;let kosong=false;
    if(!nyalakan){
      if(!confirm('Matikan data contoh harian?\n\nMulai sekarang kehadiran hanya tercatat dari scan wajah dan input guru.'))return;
      kosong=confirm('Kosongkan juga kehadiran HARI INI?\n\nPilih OK supaya semua siswa mulai dari "belum hadir" dan scan wajah langsung mencatat. Kehadiran hasil scan hari ini juga ikut terhapus.');
    }
    const r=await act(e.currentTarget,()=>authed('data_contoh_set',{p_aktif:nyalakan,p_kosongkan:kosong}));
    if(!r)return;
    toast(nyalakan?'Data contoh harian dinyalakan.':`Data contoh dimatikan${r.dihapus?`, ${r.dihapus} kehadiran hari ini dikosongkan`:''}.`,'ok');refresh(true);
  });

  /* ---------- Kamera kelas: scan wajah (face-api.js / TensorFlow.js, model CNN) ----------
     Deteksi: TinyFaceDetector (CNN), 68 titik wajah, pengenal: ResNet-34 -> descriptor 128 angka.
     Cocok bila jarak Euclid < 0.5 di 3 frame berturut-turut + terdeteksi kedipan (cek "hidup"). */
  const MATCH=0.5, SAMPLES=3;
  let faces=[], facesSig='', camMode='absen', stream=null, camTimer=null, faceapiP=null, matcher=null;
  let lastDet=[], samples=[], track=new Map(), camRecent=[], scanBusy=new Set(), announced=new Map(), loggedSudah=new Set();
  function loadFaceApi(){
    if(faceapiP)return faceapiP;
    faceapiP=new Promise((res,rej)=>{const sc=document.createElement('script');sc.src='vendor/face-api.js';sc.onload=res;sc.onerror=()=>rej(new Error('Library pengenal wajah gagal dimuat.'));document.head.appendChild(sc);})
      .then(async()=>{const fa=window.faceapi;
        try{await fa.tf.setBackend('webgl');}catch(_){}
        await fa.tf.ready();
        await Promise.all([fa.nets.tinyFaceDetector.loadFromUri('models'),fa.nets.faceLandmark68Net.loadFromUri('models'),fa.nets.faceRecognitionNet.loadFromUri('models')]);
        return fa;})
      .catch(e=>{faceapiP=null;throw e;});
    return faceapiP;
  }
  function setFaces(list){
    faces=list;const sig=list.map(f=>f.sid+':'+f.at+':'+f.n).join('|');
    if(sig!==facesSig){facesSig=sig;matcher=null;buildMatcher();}
  }
  function buildMatcher(){
    const fa=window.faceapi;if(!fa||!fa.FaceMatcher){matcher=null;return;}
    matcher=faces.length?new fa.FaceMatcher(faces.map(f=>new fa.LabeledFaceDescriptors(String(f.sid),f.d.map(a=>new Float32Array(a)))),MATCH):null;
  }
  const camMsg=(m,k)=>{const el=$('camStatus');el.textContent=m;el.className='camstatus'+(k?' '+k:'');};
  async function camStart(){
    if(stream)return;
    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia)return camMsg('Browser ini tidak mendukung kamera. Pakai Chrome/Edge terbaru lewat HTTPS.','warn');
    $('camStart').disabled=true;camMsg('Memuat model pengenal wajah (±7 MB, sekali saja)…');
    try{
      await loadFaceApi();buildMatcher();
      camMsg('Meminta izin kamera…');
      stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:640},height:{ideal:480}},audio:false});
      const v=$('camVideo');v.srcObject=stream;await v.play();
      $('camOff').hidden=true;$('camStart').hidden=true;$('camStop').hidden=false;
      track.clear();camMsg(camMode==='absen'?(faces.length?'Kamera aktif. Hadapkan wajah ke kamera lalu berkedip.':'Kamera aktif, tapi belum ada wajah terdaftar di kelas ini. Pindah ke “Daftarkan wajah”.'):'Kamera aktif. Satu siswa menghadap kamera, lalu tekan “Ambil sampel otomatis”.','ok');
      camTick();
    }catch(e){
      camStop();
      camMsg(e&&e.name==='NotAllowedError'?'Akses kamera ditolak. Izinkan kamera di pengaturan browser lalu coba lagi.':e&&e.name==='NotFoundError'?'Kamera tidak ditemukan di perangkat ini.':(e.message||'Kamera gagal dinyalakan.'),'warn');
    }finally{$('camStart').disabled=false;}
  }
  function camStop(){
    clearTimeout(camTimer);camTimer=null;
    if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}
    const v=$('camVideo');if(v)v.srcObject=null;
    if($('camOff')){$('camOff').hidden=false;$('camStart').hidden=false;$('camStop').hidden=true;
      const c=$('camCanvas');c.getContext('2d').clearRect(0,0,c.width,c.height);}
    lastDet=[];
  }
  const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  const ear=e=>(dist(e[1],e[5])+dist(e[2],e[4]))/(2*dist(e[0],e[3])||1);
  async function camTick(){
    if(!stream)return;
    const fa=window.faceapi, v=$('camVideo');
    try{
      if(v.readyState>=2&&v.videoWidth){
        lastDet=await fa.detectAllFaces(v,new fa.TinyFaceDetectorOptions({inputSize:320,scoreThreshold:0.5})).withFaceLandmarks().withFaceDescriptors();
        if(!stream)return;
        const labels=camMode==='absen'?processAbsen(lastDet):lastDet.map(()=>({txt:lastDet.length===1?'Siap diambil':'Hanya 1 wajah',col:lastDet.length===1?'#22c55e':'#f59e0b'}));
        drawDet(v,lastDet,labels);
      }
    }catch(_){}
    camTimer=setTimeout(camTick,40);
  }
  function drawDet(v,det,labels){
    const c=$('camCanvas'), W=v.videoWidth, H=v.videoHeight;
    // video tampil seperti cermin & object-fit:cover -> hitung skala yang sama untuk kotak
    const cw=c.clientWidth, ch=c.clientHeight;if(c.width!==cw||c.height!==ch){c.width=cw;c.height=ch;}
    const k=Math.max(cw/W,ch/H), ox=(cw-W*k)/2, oy=(ch-H*k)/2;
    const g=c.getContext('2d');g.clearRect(0,0,cw,ch);g.lineWidth=3;g.font='600 14px system-ui,sans-serif';
    det.forEach((d,i)=>{const b=d.detection.box, L=labels[i]||{txt:'',col:'#94a3b8'};
      const x=cw-(ox+(b.x+b.width)*k), y=oy+b.y*k, w=b.width*k, h=b.height*k;
      g.strokeStyle=L.col;g.strokeRect(x,y,w,h);
      if(L.txt){const tw=g.measureText(L.txt).width+12;g.fillStyle=L.col;g.fillRect(x,Math.max(0,y-24),tw,22);g.fillStyle='#fff';g.fillText(L.txt,x+6,Math.max(16,y-8));}
    });
  }
  function processAbsen(det){
    const seen=new Set();
    const out=det.map(d=>{
      if(!matcher)return {txt:'Belum terdaftar',col:'#94a3b8'};
      const m=matcher.findBestMatch(d.descriptor);
      if(m.label==='unknown')return {txt:'Tidak dikenal',col:'#ef4444'};
      const sid=+m.label, s=byId(sid);seen.add(sid);
      const first=s.name.split(' ')[0];
      if(hadir.has(sid)){announceSudah(sid,s.name);return {txt:first+' ✓ hadir',col:'#22c55e'};}
      const e=(ear(d.landmarks.getLeftEye())+ear(d.landmarks.getRightEye()))/2;
      const t=track.get(sid)||{hits:0,max:0,closed:false,blink:false,best:1};
      t.hits++;t.best=Math.min(t.best,m.distance);t.max=Math.max(t.max*0.98,e);
      if(t.max>0&&e<t.max*0.72)t.closed=true;else if(t.closed&&e>t.max*0.88)t.blink=true;
      track.set(sid,t);
      if(t.hits>=3&&t.blink&&!scanBusy.has(sid))markScan(sid,t.best);
      return {txt:t.hits>=3?first+' · berkedip':first+'…',col:'#3b82f6'};
    });
    for(const k of track.keys())if(!seen.has(k))track.delete(k);
    return out;
  }
  async function markScan(sid,d){
    scanBusy.add(sid);
    try{
      const r=await authed('hadir_scan',{p_sid:sid,p_jarak:Math.round(d*1000)/1000});
      hadir.add(sid);announced.set(sid,Date.now());loggedSudah.add(sid);
      camRecent.unshift({t:clock(),name:r.name,m:`hadir · kecocokan ${Math.round((1-d)*100)}%${r.telat?' · Alpa dibatalkan (terlambat)':''}`});
      camMsg(`✓ ${r.name} tercatat hadir.`,'ok');camFlash(r.name,r.telat?'hadir · terlambat, Alpa dibatalkan':'hadir');renderKamera();
    }catch(e){camMsg(e.message,'warn');}
    finally{scanBusy.delete(sid);track.delete(sid);}
  }
  // Siswa yang SUDAH tercatat hadir hari ini (scan sebelumnya / input lain) tetap diberi tahu,
  // maksimal sekali per 8 detik per siswa, dan masuk daftar sekali per sesi.
  function announceSudah(sid,name){
    const now=Date.now();
    if(now-(announced.get(sid)||0)<8000)return;
    announced.set(sid,now);
    camFlash(name,'sudah tercatat hadir hari ini');
    if(!loggedSudah.has(sid)){loggedSudah.add(sid);camRecent.unshift({t:clock(),name,m:'sudah tercatat hadir hari ini'});renderKamera();}
  }
  // Pemberitahuan besar di atas video: "✓ Bima hadir" (±3 detik) supaya siswa & guru langsung tahu
  function camFlash(name,sub){
    const f=$('camFlash');$('camFlashName').textContent=name;$('camFlashSub').textContent=sub;
    f.hidden=false;f.classList.remove('show');void f.offsetWidth;f.classList.add('show');
    clearTimeout(camFlash._t);camFlash._t=setTimeout(()=>{f.hidden=true;},3200);
  }
  function renderKamera(){
    $('camKelas').textContent='Kelas '+kelas;
    $('camCount').textContent=`${faces.length} dari ${students.length} wajah terdaftar`;
    $('camHadir').textContent=`Hadir ${hadir.size} dari ${students.length}`;
    $('camAbsenPanel').hidden=camMode!=='absen';$('camDaftarPanel').hidden=camMode!=='daftar';
    $('camLog').innerHTML=camRecent.length?camRecent.slice(0,30).map(l=>`<li><time class="mono">${esc(l.t)}</time><span>${l.name?`<b>${esc(l.name)}</b> `:''}${esc(l.m)}</span></li>`).join(''):'<li class="empty">Belum ada yang tercatat di sesi ini.</li>';
    const sel=$('enSiswa'), cur=sel.value, has=new Set(faces.map(f=>f.sid));
    sel.innerHTML=students.map(s=>`<option value="${s.id}">${esc(s.name)}${has.has(s.id)?' (sudah terdaftar)':''}</option>`).join('');
    if(cur&&students.some(s=>String(s.id)===cur))sel.value=cur;
    $('enList').innerHTML=faces.length?faces.map(f=>`<li><span><b>${esc(f.name)}</b><span class="sub">${f.n} sampel · ${esc(f.at)}</span></span><button class="btn small danger" type="button" data-wdel="${f.sid}">Hapus</button></li>`).join(''):'<li class="empty">Belum ada wajah terdaftar di kelas ini.</li>';
    renderSamples();
  }
  function renderSamples(){
    $('enN').textContent=`${samples.length}/${SAMPLES} sampel`;$('enBar').style.width=(samples.length/SAMPLES*100)+'%';
    $('enSave').disabled=samples.length<3;
  }
  $('camStart').addEventListener('click',camStart);
  $('camStop').addEventListener('click',()=>{camStop();camMsg('Kamera dihentikan.');});
  $('camMode').addEventListener('click',e=>{const b=e.target.closest('button[data-m]');if(!b)return;camMode=b.dataset.m;
    document.querySelectorAll('#camMode button').forEach(x=>x.setAttribute('aria-pressed',x===b));track.clear();
    if(stream)camMsg(camMode==='absen'?'Mode absensi. Hadapkan wajah lalu berkedip.':'Mode pendaftaran. Pilih siswa, lalu tekan “Ambil sampel otomatis” (3 foto, ±3 detik).','ok');
    renderKamera();});
  $('enSiswa').addEventListener('change',()=>{samples=[];$('enErr').hidden=true;renderSamples();});
  $('enReset').addEventListener('click',()=>{samples=[];$('enErr').hidden=true;renderSamples();});
  // Satu klik: ambil SAMPLES sampel otomatis (jeda ±0,6 dtk, wajah sedikit berbeda tiap sampel)
  let capturing=false;
  $('enShot').addEventListener('click',async()=>{
    const err=$('enErr'), fail=m=>{err.textContent=m;err.hidden=false;};
    if(capturing)return;
    if(!stream)return fail('Nyalakan kamera dulu.');
    const sid=+$('enSiswa').value, btn=$('enShot'), label=btn.textContent;
    samples=[];renderSamples();err.hidden=true;capturing=true;btn.disabled=true;
    camMsg('Mengambil sampel… lihat kamera dan gerakkan kepala sedikit ke kiri-kanan.','ok');
    const until=Date.now()+10000;let why='';
    while(samples.length<SAMPLES&&Date.now()<until&&stream){
      await new Promise(r=>setTimeout(r,250));
      if(lastDet.length!==1){why=lastDet.length?'Terlihat lebih dari satu wajah. Pastikan hanya satu siswa di depan kamera.':'Wajah belum terdeteksi. Dekatkan wajah dan pastikan cahaya cukup.';continue;}
      const d=lastDet[0];
      if(d.detection.score<0.7){why='Wajah kurang jelas. Hadap ke kamera dengan cahaya dari depan.';continue;}
      if(matcher){const m=matcher.findBestMatch(d.descriptor);if(m.label!=='unknown'&&+m.label!==sid&&m.distance<0.42){why=`Wajah ini sangat mirip dengan ${byId(+m.label).name} yang sudah terdaftar. Periksa siswa yang dipilih.`;break;}}
      if(samples.length){
        const fa=window.faceapi, d0=fa.euclideanDistance(samples[0],d.descriptor), dl=fa.euclideanDistance(samples[samples.length-1],d.descriptor);
        if(d0>0.55){why='Sampel tampak dari orang yang berbeda. Pastikan hanya satu siswa di depan kamera.';samples=[];renderSamples();continue;}
        if(dl<0.04)continue; // terlalu mirip dengan sampel sebelumnya, tunggu posisi sedikit berubah
      }
      samples.push(Array.from(d.descriptor,x=>Math.round(x*1e5)/1e5));why='';renderSamples();
      await new Promise(r=>setTimeout(r,350));
    }
    capturing=false;btn.disabled=false;btn.textContent=label;
    if(samples.length>=SAMPLES)camMsg(`${SAMPLES} sampel lengkap. Isi persetujuan lalu tekan “Simpan wajah”.`,'ok');
    else{fail(why||'Sampel belum lengkap. Coba lagi.');camMsg('Pengambilan sampel belum selesai.','warn');}
  });
  $('enSave').addEventListener('click',async e=>{
    const err=$('enErr'), fail=m=>{err.textContent=m;err.hidden=false;};
    const sid=+$('enSiswa').value, ortu=$('enOrtu').value.trim();
    if(!$('enSetuju').checked)return fail('Centang persetujuan orang tua/wali terlebih dahulu.');
    if(ortu.length<3)return fail('Isi nama orang tua/wali yang memberi persetujuan.');
    const n=await act(e.currentTarget,()=>authed('wajah_simpan',{p_sid:sid,p_desc:samples,p_persetujuan:ortu}));
    if(n==null)return;
    toast(`Wajah ${byId(sid).name} tersimpan (${n} sampel).`,'ok');
    samples=[];$('enOrtu').value='';$('enSetuju').checked=false;err.hidden=true;
    const nx=students.find(s=>!faces.some(f=>f.sid===s.id)&&s.id!==sid);if(nx)$('enSiswa').value=nx.id;
    refresh(true);
  });
  $('enList').addEventListener('click',async e=>{const b=e.target.closest('button[data-wdel]');if(!b)return;
    const s=byId(+b.dataset.wdel);if(!confirm(`Hapus data wajah ${s.name}? Siswa ini tidak akan dikenali kamera sampai didaftarkan lagi.`))return;
    const ok=await act(b,()=>authed('wajah_hapus',{p_sid:s.id}).then(()=>true));if(ok){toast(`Data wajah ${s.name} dihapus.`);refresh(true);}});

  /* ---------- Log ---------- */
  function renderLog(){
    $('log').innerHTML=log.length?log.map(l=>`<li><time class="mono">${esc(l.t)}</time><span>${esc(l.m)}</span></li>`).join(''):'<li class="empty">Belum ada aktivitas.</li>';
  }

  function renderAll(){
    if(!session)return;
    if(view==='lapor'){renderKelasSel();renderTiles();renderQueue();renderTable();renderChart();renderWatch();}
    if(view==='kamera')renderKamera();
    if(view==='verif')renderVerif();
    if(view==='rekap')renderRekap();
    if(view==='users')renderUsers();
    if(view==='siswa')renderSiswa();
    renderLog();
  }

  /* ---------- Form orang tua ---------- */
  const P={days:1,kelasLoaded:false};
  const addDays=(s,n)=>{const [y,m,d]=s.split('-').map(Number);return iso(new Date(y,m-1,d+n));};
  if(/^https?:$/.test(location.protocol))$('parentLink').textContent=location.origin+location.pathname+'#lapor';
  $('pDate').textContent=now.toLocaleDateString('id-ID',{weekday:'long',day:'numeric',month:'long',year:'numeric'});

  async function loadParentKelas(pre){
    if(!P.kelasLoaded){
      try{const list=await rpc('ortu_kelas');
        $('pKelas').innerHTML='<option value="">Pilih kelas</option>'+(list||[]).map(k=>`<option>${esc(k)}</option>`).join('');P.kelasLoaded=true;}
      catch(e){$('pKelas').innerHTML='<option value="">Gagal memuat — coba muat ulang</option>';$('pErr').textContent=e.message;$('pErr').hidden=false;return;}
    }
    if(pre&&[...$('pKelas').options].some(o=>o.value===pre)){$('pKelas').value=pre;await loadParentSiswa();}
  }
  async function loadParentSiswa(){
    const k=$('pKelas').value, sel=$('pChild');
    sel.disabled=true;$('pStatusNote').hidden=true;
    if(!k){sel.innerHTML='<option value="">Pilih kelas dulu</option>';return;}
    sel.innerHTML='<option value="">Memuat…</option>';
    try{const list=await rpc('ortu_siswa',{p_kelas:k});
      sel.innerHTML='<option value="">Pilih nama anak</option>'+(list||[]).map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');sel.disabled=false;}
    catch(e){sel.innerHTML='<option value="">Gagal memuat</option>';toast(e.message,'warn');}
  }
  $('pKelas').addEventListener('change',loadParentSiswa);

  function showParent(pre){
    $('loginView').hidden=true;$('appView').hidden=true;$('parentView').hidden=false;
    $('pBack').hidden=false;$('backDash').textContent=session?'Kembali ke dashboard':'Kembali ke login';
    resetParent();window.scrollTo(0,0);
    loadParentKelas(pre||(session&&kelas)||'');
  }
  function leaveParent(){
    $('parentView').hidden=true;
    if(session){$('appView').hidden=false;refresh(true);}else{$('loginView').hidden=false;}
    try{if(/^#(lapor|cek)/.test(location.hash))history.replaceState(null,'',location.pathname+location.search);}catch(_){}
  }
  $('toParent').addEventListener('click',()=>showParent());
  $('openParent').addEventListener('click',()=>showParent(kelas));
  $('backDash').addEventListener('click',leaveParent);

  function pRangeText(){
    let dari=todayISO,sampai=addDays(todayISO,P.days-1);
    if(P.days===0){dari=$('pDari').value;sampai=$('pSampai').value;}
    const n=Math.round((new Date(sampai)-new Date(dari))/864e5)+1;
    $('pRange').textContent=dari&&sampai&&n>0?(n===1?'Tanggal: '+fmtDate(dari):`Tanggal: ${fmtDate(dari)} – ${fmtDate(sampai)} (${n} hari)`):'';
    const j=document.querySelector('input[name=pjenis]:checked');
    $('pFileReq').textContent=j&&j.value==='sakit'&&n>2?'(wajib, surat dokter untuk sakit lebih dari 2 hari)':'(opsional)';
    return {dari,sampai,n};
  }
  function pChipsRender(){
    const j=document.querySelector('input[name=pjenis]:checked');
    $('pChips').innerHTML=j?templates[j.value].map(t=>`<button type="button" class="chip">${t}</button>`).join(''):'<span class="hint">Pilih Sakit atau Izin dulu, nanti muncul pilihan cepat.</span>';
    pRangeText();
  }
  // Status anak baru ditampilkan setelah 4 angka NIS dicocokkan oleh server
  let pCheckSeq=0;
  async function pCheckChild(){
    const id=+$('pChild').value, nis=$('pNis').value, note=$('pStatusNote');
    note.hidden=true;note.className='pnote';
    if(!id||nis.length!==4)return;
    const seq=++pCheckSeq, name=$('pChild').selectedOptions[0].textContent;
    let r;try{r=await rpc('ortu_cek',{p_sid:id,p_nis:nis});}catch(_){return;}
    if(seq!==pCheckSeq)return;
    note.hidden=false;
    if(!r.ok){note.classList.add('warn');note.textContent=r.msg;return;}
    if(r.ada){note.classList.add('warn');note.textContent=`Laporan untuk ${name} hari ini sudah ada di sekolah. Tidak perlu mengirim lagi.`;}
    else if(r.hadir){note.classList.add('warn');note.textContent=`${name} sudah tercatat hadir hari ini lewat scan wajah. Jika anak pulang lebih awal karena sakit, tetap boleh melapor.`;}
    else{note.classList.add('ok');note.textContent='✓ NIS cocok.';}
  }
  function resetParent(){
    $('pForm').reset();$('pForm').hidden=false;$('pDone').hidden=true;$('pErr').hidden=true;$('pStatusNote').hidden=true;
    if(P.kelasLoaded){$('pChild').innerHTML='<option value="">Pilih kelas dulu</option>';$('pChild').disabled=true;}
    P.days=1;document.querySelectorAll('#pDays button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.d==='1'));
    $('pCustom').hidden=true;$('pDari').value=todayISO;$('pSampai').value=todayISO;
    $('pFileName').textContent='Ketuk untuk memotret atau memilih foto surat';$('pFile').closest('.upload').classList.remove('has');
    if($('pPrev').src)URL.revokeObjectURL($('pPrev').src);$('pPrev').removeAttribute('src');$('pPrev').hidden=true;
    pChipsRender();
  }
  $('pChild').addEventListener('change',pCheckChild);
  $('pNis').addEventListener('input',e=>{e.target.value=e.target.value.replace(/\D/g,'').slice(0,4);pCheckChild();});
  document.querySelectorAll('input[name=pjenis]').forEach(r=>r.addEventListener('change',pChipsRender));
  $('pChips').addEventListener('click',e=>{const c=e.target.closest('.chip');if(!c)return;const t=$('pKet');t.value=t.value?t.value.replace(/[\s.]*$/,'')+'. '+c.textContent:c.textContent;t.focus();});
  $('pDays').addEventListener('click',e=>{const b=e.target.closest('button[data-d]');if(!b)return;P.days=+b.dataset.d;
    document.querySelectorAll('#pDays button').forEach(x=>x.setAttribute('aria-pressed',x===b));$('pCustom').hidden=P.days!==0;pRangeText();});
  $('pDari').addEventListener('change',pRangeText);$('pSampai').addEventListener('change',pRangeText);
  $('pFile').addEventListener('change',e=>{const f=e.target.files[0],bad=checkFile(f);
    if($('pPrev').src)URL.revokeObjectURL($('pPrev').src);$('pPrev').removeAttribute('src');$('pPrev').hidden=true;
    if(bad){e.target.value='';$('pErr').textContent=bad;$('pErr').hidden=false;$('pFileName').textContent='Ketuk untuk memotret atau memilih foto surat';e.target.closest('.upload').classList.remove('has');return;}
    $('pErr').hidden=true;
    $('pFileName').textContent=f?'✓ '+safeName(f.name):'Ketuk untuk memotret atau memilih foto surat';e.target.closest('.upload').classList.toggle('has',!!f);
    if(f&&f.type.startsWith('image/')){$('pPrev').src=URL.createObjectURL(f);$('pPrev').hidden=false;}});

  $('pForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const err=$('pErr'), fail=m=>{err.textContent=m;err.hidden=false;err.scrollIntoView({behavior:'smooth',block:'center'});};
    const id=+$('pChild').value;
    if(!$('pKelas').value)return fail('Pilih kelas anak.');
    if(!id)return fail('Pilih nama anak.');
    const nis=$('pNis').value;
    if(nis.length!==4)return fail('Isi 4 angka terakhir NIS anak.');
    const j=document.querySelector('input[name=pjenis]:checked');
    if(!j)return fail('Pilih Sakit atau Izin.');
    const ket=$('pKet').value.trim();
    if(ket.length<5)return fail('Tulis keterangan minimal 5 karakter.');
    const {dari,sampai,n}=pRangeText();
    if(!dari||!sampai||n<1)return fail('Periksa tanggal mulai dan selesai.');
    if(n>14)return fail('Periode maksimal 14 hari. Untuk izin lebih lama, hubungi sekolah langsung.');
    const f=$('pFile').files[0], fbad=checkFile(f);
    if(fbad)return fail(fbad);
    if(j.value==='sakit'&&n>2&&!f)return fail('Sakit lebih dari 2 hari wajib melampirkan foto surat dokter.');
    const nama=$('pName').value.trim().replace(/\s+/g,' ').slice(0,60);
    if(nama.length<2)return fail('Isi nama Anda sebagai pelapor.');
    err.hidden=true;
    const btn=$('pForm').querySelector('button[type=submit]'), label=btn.textContent;
    btn.disabled=true;btn.textContent='Mengirim…';
    let res;
    try{
      const file=await packFile(f);
      res=await rpc('ortu_kirim',{p:{sid:id,nis,jenis:j.value,ket,dari,sampai,nama,rel:$('pRel').value,web:$('pWeb').value,file}});
    }catch(ex){return fail(ex.message);}
    finally{btn.disabled=false;btn.textContent=label;}
    if(!res.ok)return fail(res.msg);
    const childName=$('pChild').selectedOptions[0].textContent, rel=$('pRel').value;
    $('pReceipt').innerHTML=[
      ['Nomor laporan',`<span class="mono" id="pReceiptNo">${esc(res.no)}</span>`],['Nama anak',esc(childName)],['Kelas',esc($('pKelas').value)],['Jenis',`<span class="pill ${j.value}">${LBL[j.value]}</span>`],
      ['Tanggal',n===1?fmtDate(dari):`${fmtDate(dari)} – ${fmtDate(sampai)}`],['Keterangan',esc(ket)],['Lampiran',res.file?esc(res.file):'Tidak ada'],
      ['Pelapor',`${esc(rel)} · ${esc(nama)}`],['Status','<span class="pill wait">Menunggu wali kelas</span>']
    ].map(([a,b])=>`<div><span>${a}</span><span>${b}</span></div>`).join('');
    $('pForm').hidden=true;$('pDone').hidden=false;window.scrollTo(0,0);
  });
  $('pAgain').addEventListener('click',()=>{const k=$('pKelas').value;resetParent();$('pKelas').value=k;loadParentSiswa();});

  /* ---------- Cek status laporan (orang tua) ---------- */
  $('cForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const no=$('cNo').value.trim().toUpperCase(), out=$('cResult');
    if(!/^HDR-\d{6}-[A-Z0-9]{3,5}$/.test(no)){out.hidden=false;out.innerHTML='<p class="err">Format nomor: HDR-YYMMDD-ABCDE</p>';return;}
    out.hidden=false;out.innerHTML='<div class="empty">Mencari…</div>';
    let r;try{r=await rpc('ortu_status',{p_no:no});}catch(ex){out.innerHTML=`<p class="err">${esc(ex.message)}</p>`;return;}
    if(!r.ok){out.innerHTML=`<div class="empty">${esc(r.msg)}</div>`;return;}
    const acc=r.status==='diterima';
    const steps=[['Laporan terkirim',true],['Diterima wali kelas',acc],
      ...(r.file?[[r.verif==='ditolak'?'Surat ditolak TU':'Surat diverifikasi TU',acc&&(r.verif==='disetujui'||r.verif==='ditolak'),r.verif==='ditolak']]:[])];
    out.innerHTML=`<div class="receipt"><div><span>Nomor</span><span class="mono">${esc(r.no)}</span></div><div><span>Nama anak</span><span>${esc(r.name)} · ${esc(r.kelas)}</span></div><div><span>Jenis</span><span><span class="pill ${esc(r.jenis)}">${LBL[r.jenis]}</span></span></div><div><span>Tanggal</span><span>${r.dari===r.sampai?fmtDate(r.dari):fmtDate(r.dari)+' – '+fmtDate(r.sampai)}</span></div></div>
      <ol class="timeline">${steps.map(([t,done,bad])=>`<li class="${bad?'bad':done?'done':''}"><span></span>${t}</li>`).join('')}</ol>
      ${r.verif==='ditolak'&&r.alasan?`<p class="pnote warn">Alasan: ${esc(r.alasan)}</p>`:''}`;
  });
  document.querySelectorAll('#pTabs button').forEach(b=>b.addEventListener('click',()=>setParentTab(b.dataset.pt)));
  function setParentTab(t){
    document.querySelectorAll('#pTabs button').forEach(x=>x.setAttribute('aria-selected',x.dataset.pt===t));
    $('pLapor').hidden=t!=='lapor';$('pCek').hidden=t!=='cek';
    if(t==='cek'){$('cResult').hidden=true;$('cNo').focus();}
  }
  $('pCekBtn').addEventListener('click',()=>{$('cNo').value=$('pReceiptNo').textContent;setParentTab('cek');$('cForm').requestSubmit();});

  /* ---------- Pencarian, ekspor, cetak ---------- */
  $('qSearch').addEventListener('input',renderQueue);
  $('tSearch').addEventListener('input',renderTable);
  $('exportDay').addEventListener('click',()=>{
    download(`laporan-${kelas.replace(/\s+/g,'-')}-${todayISO}.csv`,[['Nama','NIS','Kelas','Status','Keterangan','Mulai','Sampai','Pelapor','Lampiran','Verifikasi','Jam','Dicatat oleh','No. laporan'],
      ...reports.map(r=>{const s=byId(r.sid);return [s.name,s.nis,r.kelas,LBL[r.jenis],r.ket,r.dari,r.sampai,r.pelapor,r.file,r.verif||'',r.jam,r.oleh||'',r.no||''];})]);
    authed('log_tulis',{p_msg:`mengekspor laporan harian ${kelas} ke CSV.`}).catch(()=>{});toast('File CSV diunduh. Bisa dibuka di Excel.','ok');
  });
  $('exportRekap').addEventListener('click',()=>{
    download(`rekap-sekolah-${todayISO}.csv`,[['Kelas','Wali kelas','Siswa','Hadir','Sakit','Izin','Alpa','Belum lapor','Kehadiran (%)'],...rrows.map(r=>[...r,r[2]?Math.round(r[3]/r[2]*100):0])]);
    authed('log_tulis',{p_msg:'mengekspor rekap sekolah ke CSV.'}).catch(()=>{});toast('Rekap sekolah diunduh sebagai CSV.','ok');
  });
  $('exportLog').addEventListener('click',()=>{download(`log-audit-${todayISO}.csv`,[['Waktu','Aktivitas','Cakupan'],...log.map(l=>[l.t,l.m,l.scope])]);toast('Log audit diunduh.','ok');});
  $('printRekap').addEventListener('click',()=>window.print());
  $('resetDemo').addEventListener('click',async e=>{
    if(!confirm('Kembalikan SEMUA data demo di server ke kondisi awal? Akun, laporan, lampiran, dan log yang dibuat akan hilang untuk semua pengguna.'))return;
    const ok=await act(e.currentTarget,()=>authed('reset_demo').then(()=>true));
    if(!ok)return;
    try{session=await authed('sesi_cek');}catch(_){return;}
    clearSelection();resetForm();toast('Data demo dikembalikan ke kondisi awal.','ok');refresh(true);
  });

  /* ---------- Navigasi hash: #lapor, #lapor?k=KELAS, #cek ---------- */
  function route(){
    const h=location.hash;
    if(/^#lapor/.test(h)){const m=h.match(/[?&]k=([^&]+)/);let k='';try{k=m?decodeURIComponent(m[1]):'';}catch(_){}
      showParent(k);setParentTab('lapor');return true;}
    if(/^#cek/.test(h)){showParent();setParentTab('cek');return true;}
    return false;
  }
  window.addEventListener('hashchange',route);

  /* ---------- Mulai ---------- */
  resetForm();
  if(!configured){$('loginErr').textContent='Server belum dikonfigurasi (supabase/config.json). Hubungi admin.';$('loginErr').hidden=false;}
  const saved=store.sget(SESS_KEY);
  const routed=route();
  if(!routed&&saved&&saved.token&&saved.exp>Date.now()){
    token=saved.token;
    rpc('sesi_cek',{p_token:token}).then(u=>{if(!token)return;session=u;startSession();}).catch(()=>{token=null;store.sdel(SESS_KEY);});
  }
})();
