// NEON HARBOR — the HUD: every DOM element that shows the match. It only
// reads the world and writes text/classes; it never changes game state
// except through the buy callback the main loop wires up.
import { BUY_MENU, ROUND } from './config.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.el = {
      crosshair: $('crosshair'), hitmarker: $('hitmarker'), vignette: $('vignette'),
      timer: $('timer'), scoreR: $('score-r'), scoreG: $('score-g'),
      roundLabel: $('round-label'), objective: $('objective'), feed: $('feed'),
      banner: $('banner'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
      prompt: $('prompt'), progressWrap: $('progress-wrap'), progressLabel: $('progress-label'),
      progressFill: $('progress-fill'), healthNum: $('health-num'), healthFill: $('health-fill'),
      armourRow: $('armour-row'), moneyRow: $('money-row'), weaponName: $('weapon-name'),
      ammo: $('ammo'), ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'),
      grenades: $('grenades'), reloadNote: $('reload-note'), spectate: $('spectate'),
      buy: $('buy'), buyRows: $('buy-rows'), buyMoney: $('buy-money'),
      menu: $('menu'), matchend: $('matchend'), paused: $('paused'),
      matchTitle: $('match-title'), matchScore: $('match-score'),
    };
    this._last = {};
    this._bannerTimer = 0;
    this._hitTimer = 0;
    this.onBuy = null;
    this._buildBuyRows();
  }

  _set(key, el, value) {
    if (this._last[key] !== value) { this._last[key] = value; el.textContent = value; }
  }

  _buildBuyRows() {
    for (const row of BUY_MENU) {
      const div = document.createElement('div');
      div.className = 'buy-row';
      div.dataset.key = row.key;
      div.innerHTML = `<span class="key">${row.key}</span><span class="name">${row.name}<small>${row.desc}</small></span><span class="price">$${row.price}</span>`;
      div.addEventListener('click', () => { if (this.onBuy) this.onBuy(row.key); });
      this.el.buyRows.appendChild(div);
    }
  }

  showBanner(title, sub = '', ms = 2600) {
    this.el.bannerTitle.textContent = title;
    this.el.bannerSub.textContent = sub;
    this.el.banner.classList.add('show');
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => this.el.banner.classList.remove('show'), ms);
  }

  flashHitmarker(kill) {
    this.el.hitmarker.classList.toggle('kill', kill);
    this.el.hitmarker.classList.add('on');
    clearTimeout(this._hitTimer);
    this._hitTimer = setTimeout(() => this.el.hitmarker.classList.remove('on'), 110);
  }

  flashDamage() {
    this.el.vignette.style.opacity = '0.9';
    setTimeout(() => { this.el.vignette.style.opacity = ''; }, 130);
  }

  _fmtTime(s) {
    const t = Math.max(0, Math.ceil(s));
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  }

  update(world, player, dt) {
    const e = this.el;
    const inMatch = world.phase !== 'menu' && world.phase !== 'matchEnd';

    // Top bar.
    this._set('scoreR', e.scoreR, String(world.score.raiders));
    this._set('scoreG', e.scoreG, String(world.score.guard));
    this._set('round', e.roundLabel, `ROUND ${Math.min(world.round, ROUND.maxRounds)} / ${ROUND.maxRounds}`);
    let timerText = this._fmtTime(world.phaseT);
    if (world.phase === 'buy') timerText = 'BUY ' + this._fmtTime(world.phaseT);
    if (world.phase === 'planted') timerText = '💣 ' + this._fmtTime(world.bomb.timer);
    if (world.phase === 'ended') timerText = '—';
    this._set('timer', e.timer, timerText);
    e.timer.classList.toggle('urgent', world.phaseT <= 10 && (world.phase === 'live' || world.phase === 'planted'));

    // Objective line.
    let obj = '';
    if (world.phase === 'ended') {
      obj = world.winner === 'raiders'
        ? `RAIDERS win the round — <b>${world.winReason}</b>`
        : `GUARD wins the round — <b>${world.winReason}</b>`;
    } else if (world.phase === 'planted') {
      obj = player.team === 'guard'
        ? `CHARGE PLANTED at <b>${world.bomb.site}</b> — defuse it!`
        : `CHARGE PLANTED at <b>${world.bomb.site}</b> — defend it!`;
    } else if (player.carryingBomb) {
      obj = 'You carry the <b>charge</b> — plant at A or B (hold E)';
    } else if (world.bomb.state === 'dropped') {
      obj = 'Charge <b>dropped</b> — a Raider must pick it up';
    } else if (world.phase === 'buy') {
      obj = 'Buy phase — spend your cash, then push a site';
    } else {
      obj = 'Plant the charge at <b>A</b> or <b>B</b> — or eliminate the Guard';
    }
    if (this._last.obj !== obj) { this._last.obj = obj; e.objective.innerHTML = obj; }

    // Kill feed.
    const feedHtml = world.feed.slice(-5).map((f) => {
      const cls = f.team === 'raiders' ? 'r' : f.team === 'guard' ? 'g' : '';
      return `<div><span class="${cls}">${f.text.split('  ▸  ')[0]}</span> ▸ ${f.text.split('  ▸  ')[1] ?? ''}</div>`;
    }).join('');
    if (this._last.feed !== feedHtml) { this._last.feed = feedHtml; e.feed.innerHTML = feedHtml; }

    // Crosshair gap from live spread.
    const spread = player.weapon ? player.weapon.spread + player.bloom : 0.01;
    const gap = Math.round(6 + spread * 260 + (player.ads ? -3 : 0) + (player.moveSpeed > 1 ? 3 : 0));
    e.crosshair.style.setProperty('--gap', `${gap}px`);
    const crossVisible = inMatch && player.alive && !world.ui.buyOpen && !world.paused;
    e.crosshair.classList.toggle('hidden', !crossVisible);

    // Bottom left: health, armour, money.
    this._set('hp', e.healthNum, String(Math.max(0, Math.ceil(player.hp))));
    e.healthNum.classList.toggle('low', player.hp <= 30);
    e.healthFill.style.width = `${Math.max(0, player.hp)}%`;
    e.healthFill.style.background = player.hp <= 30 ? 'var(--danger)' : '#7dd87d';
    this._set('armour', e.armourRow, `ARMOUR ${Math.round(player.armour)}`);
    this._set('money', e.moneyRow, `$${player.money}`);
    e.vignette.classList.toggle('lowhp', player.alive && player.hp <= 30);

    // Bottom right: weapon, ammo, grenades, reload.
    this._set('wname', e.weaponName, player.weapon.name);
    this._set('mag', e.ammoMag, String(player.mag));
    this._set('res', e.ammoReserve, `/ ${player.reserve}`);
    e.ammo.classList.toggle('empty', player.mag === 0);
    this._set('nades', e.grenades, `FRAG ${player.grenades.frag}  ·  SMOKE ${player.grenades.smoke}`);
    e.reloadNote.hidden = !player.reloading;

    // Context prompt + progress bar.
    let prompt = '';
    if (world.phase === 'buy' && !world.ui.buyOpen && player.alive) prompt = '<kbd>B</kbd> Buy menu';
    else if (player.planting) prompt = 'Planting the charge…';
    else if (player.defusing) prompt = 'Defusing the charge…';
    else if (player.carryingBomb && world.phase === 'live') {
      const near = Object.entries(world.map.sites).find(([, s]) => player.pos.distanceTo(s.pos) < s.radius);
      if (near) prompt = '<kbd>E</kbd> Hold to plant the charge';
    } else if (world.bomb.state === 'planted' && player.team === 'guard' && player.alive) {
      if (player.pos.distanceTo(world.bomb.pos) < 3) prompt = '<kbd>E</kbd> Hold to defuse the charge';
    }
    if (this._last.prompt !== prompt) {
      this._last.prompt = prompt;
      e.prompt.innerHTML = prompt;
      e.prompt.hidden = !prompt;
    }
    const prog = player.planting ? player.plantProgress : player.defusing ? player.defuseProgress : 0;
    const progLabel = player.planting ? 'PLANTING CHARGE' : player.defusing ? 'DEFUSING CHARGE' : '';
    e.progressWrap.classList.toggle('show', prog > 0);
    if (prog > 0) {
      e.progressLabel.textContent = progLabel;
      e.progressFill.style.width = `${Math.round(prog * 100)}%`;
    }

    // Spectator label.
    if (!player.alive && inMatch) {
      const target = world.agents.find((a) => a.id === world.spectateId);
      const label = target ? `SPECTATING ${target.name} — you respawn next round` : 'You are down — respawn next round';
      this._set('spec', e.spectate, label);
      e.spectate.hidden = false;
    } else e.spectate.hidden = true;

    // Buy menu.
    e.buy.hidden = !world.ui.buyOpen;
    if (world.ui.buyOpen) {
      this._set('buymoney', e.buyMoney, `$${player.money}`);
      for (const rowEl of e.buyRows.children) {
        const row = BUY_MENU.find((r) => r.key === rowEl.dataset.key);
        const affordable = row && player.money >= row.price
          && !(row.kind === 'weapon' && player.weapon.id === row.id)
          && !(row.kind === 'armour' && player.armour >= 100);
        rowEl.classList.toggle('cant', !affordable);
      }
    }

    // Overlays.
    e.menu.hidden = world.phase !== 'menu';
    e.matchend.hidden = world.phase !== 'matchEnd';
    e.paused.hidden = !world.paused || world.phase === 'menu' || world.phase === 'matchEnd';
  }

  showMatchEnd(winner) {
    const e = this.el;
    if (winner === 'raiders') {
      e.matchTitle.textContent = 'RAIDERS WIN';
      e.matchTitle.className = 'win';
    } else if (winner === 'guard') {
      e.matchTitle.textContent = 'GUARD WINS';
      e.matchTitle.className = 'lose';
    } else {
      e.matchTitle.textContent = 'DRAW';
      e.matchTitle.className = '';
    }
    e.matchScore.textContent = `RAIDERS ${this._last.scoreR ?? 0} — ${this._last.scoreG ?? 0} GUARD`;
  }
}
