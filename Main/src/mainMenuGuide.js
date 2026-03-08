// Edit this file to update the main menu guide without touching HTML.

export const MAIN_MENU_GUIDE = {
  eyebrow: "Field Manual",
  title: "Game Guide",
  heroBadge: "Start Here",
  heroTitle: "How PixelFront Works",
  heroSummary: "This guide explains the full game loop in <strong>simple language</strong>. Open what you need, skip the rest, and watch for <em>bold</em> key terms and <span class=\"guideToneGold\">important highlights</span>.",
  heroHighlights: [
    { icon: "/UI_Icons/gold.png", label: "Grow your economy" },
    { icon: "/UI_Icons/Expressions/allied.png", label: "Manage diplomacy" },
    { icon: "/UI_Icons/ResearchPoints.png", label: "Unlock upgrades" },
    { icon: "/UI_Icons/Expressions/Crown.png", label: "Protect your capital" }
  ],
  sections: [
    {
      badge: "Start Here",
      title: "The Basic Flow",
      summary: "<strong>Build up</strong>, claim land, manage neighbors, and <em>outlast</em> every other nation.",
      open: true,
      icons: [
        { src: "/Structures/capital.png", label: "Capital" },
        { src: "/UI_Icons/gold.png", label: "Gold" },
        { src: "/UI_Icons/infantry.png", label: "Infantry" },
        { src: "/UI_Icons/Expressions/victory.png", label: "Victory" }
      ],
      paragraphs: [
        "Every match starts with a <strong>Capital</strong>, a small economy, and nearby land to grow into. Your goal is to turn that start into <span class=\"guideToneGold\">Gold</span>, troops, territory, and strategic reach.",
        "Most of the game is one loop: <em>build, grow, expand, adapt</em>. Raise population and infantry, then use diplomacy, trade, research, or special weapons to stay ahead."
      ],
      bullets: [
        "<strong>Choose your setup</strong> in Play before the match starts.",
        "<strong>Right-click</strong> a tile or selected area to see actions for that location.",
        "<strong>Expand</strong> is for neutral land, <span class=\"guideToneRed\">Attack</span> is for enemy land, and ocean tiles use <strong>Send Warship</strong>.",
        "<span class=\"guideToneGold\">Victory</span> comes when every other nation is eliminated."
      ],
      cards: [
        {
          icon: "/Structures/capital.png",
          title: "Capital",
          description: "Your capital is the heart of your nation. Losing it is dangerous and can trigger a collapse."
        },
        {
          icon: "/UI_Icons/gold.png",
          title: "Gold",
          description: "Gold pays for buildings, fleets, transport planes, and many aggressive actions."
        },
        {
          icon: "/UI_Icons/infantry.png",
          title: "Infantry",
          description: "Infantry is the main fuel for land expansion, attacks, transports, and airborne drops."
        },
        {
          icon: "/UI_Icons/Expressions/Crown.png",
          title: "Goal",
          description: "Strong nations balance growth, defense, and timing instead of only rushing one system."
        }
      ]
    },
    {
      badge: "Economy",
      title: "Population, Gold, and Stability",
      summary: "<strong>Cities</strong> grow people, <strong>Factories</strong> fund expansion, and <em>Stability</em> decides how well you fight.",
      icons: [
        { src: "/Structures/city.png", label: "City" },
        { src: "/Structures/factory.png", label: "Factory" },
        { src: "/UI_Icons/population.png", label: "Population" },
        { src: "/UI_Icons/stability.png", label: "Stability" }
      ],
      paragraphs: [
        "<strong>Population</strong> is the base for both workers and soldiers. Cities raise your population cap, while factories turn that population into stronger income and steel output.",
        "Mobilizing harder gives you a bigger army, but it also pulls people away from work. If you stay overextended or stuck in <span class=\"guideToneRed\">war</span> too long, <span class=\"guideToneGreen\">stability</span> falls and your military becomes less efficient."
      ],
      bullets: [
        "<strong>Cities</strong> add steady <span class=\"guideToneGold\">Gold</span> and raise population capacity.",
        "<strong>Factories</strong> add strong income and produce steel.",
        "<strong>More mobilization</strong> means more troops, but fewer workers and less income.",
        "<span class=\"guideToneGreen\">Low stability</span> makes wars and recovery harder."
      ],
      cards: [
        {
          icon: "/Structures/city.png",
          title: "City",
          description: "Main source of population cap, food production, and steady civic income."
        },
        {
          icon: "/Structures/factory.png",
          title: "Factory",
          description: "Your best industrial building for gold and steel once your economy is rolling."
        },
        {
          icon: "/UI_Icons/population.png",
          title: "Population",
          description: "Population feeds both the workforce and your troop ceiling, so growth matters all game."
        },
        {
          icon: "/UI_Icons/stability.png",
          title: "Stability",
          description: "Stable nations defend and attack better. Long wars and strain chip away at that edge."
        }
      ]
    },
    {
      badge: "Land War",
      title: "Infantry, Expansion, and Attacks",
      summary: "<strong>Infantry</strong> is the fuel for claiming tiles and fighting on land.",
      icons: [
        { src: "/UI_Icons/infantry.png", label: "Infantry" },
        { src: "/Structures/barracks.png", label: "Barracks" },
        { src: "/Structures/defence_post.png", label: "Defence Post" },
        { src: "/UI_Icons/Expressions/Target.png", label: "Attack Ratio" }
      ],
      paragraphs: [
        "<strong>Barracks</strong> train infantry passively over time, so more barracks means faster recovery and more pressure on the map. You do not manually queue infantry in this build.",
        "Expanding into neutral land spends infantry and a small amount of <span class=\"guideToneGold\">Gold</span> per tile. Fighting enemy land does the same, but only during active <span class=\"guideToneRed\">war</span>. <strong>Attack Ratio</strong> controls how aggressively your wars spend troops."
      ],
      bullets: [
        "<strong>Expand</strong> from your borders to take neutral land.",
        "<span class=\"guideToneRed\">Declare war</span> before trying to attack enemy territory.",
        "<strong>Barracks</strong> refill infantry automatically.",
        "<strong>Defence Posts</strong> and capitals make nearby land harder to capture."
      ],
      cards: [
        {
          icon: "/UI_Icons/infantry.png",
          title: "Infantry",
          description: "Used for neutral expansion, focus attacks, transports, and airborne missions."
        },
        {
          icon: "/Structures/barracks.png",
          title: "Barracks",
          description: "Passively trains infantry and keeps your nation ready for longer wars."
        },
        {
          icon: "/Structures/defence_post.png",
          title: "Defence Post",
          description: "Adds local capture resistance and is excellent for border cities or choke points."
        },
        {
          icon: "/UI_Icons/Expressions/Target.png",
          title: "Attack Ratio",
          description: "Higher attack ratio spends troops more aggressively. Lower ratio plays safer and steadier."
        }
      ]
    },
    {
      badge: "Diplomacy",
      title: "Diplomacy, Alliances, and Ceasefires",
      summary: "Neighbors can be neutral, <span class=\"guideToneGreen\">allied</span>, or <span class=\"guideToneRed\">at war</span>, and those states change what actions are allowed.",
      icons: [
        { src: "/UI_Icons/Expressions/allied.png", label: "Alliance" },
        { src: "/UI_Icons/Expressions/ceasefire.png", label: "Ceasefire" },
        { src: "/UI_Icons/Expressions/war.png", label: "War" }
      ],
      paragraphs: [
        "<strong>Right-click another nation</strong> to handle diplomacy. A neutral nation can become an ally, an enemy, or a trade partner depending on the current relationship.",
        "<span class=\"guideToneGreen\">Alliances</span> block attacks and open trade. <em>Ceasefires</em> pause active fighting without fully resetting the war relationship, so they are breathing room rather than a full friendship."
      ],
      bullets: [
        "<strong>Alliance requests</strong> can be accepted or rejected.",
        "<span class=\"guideToneGreen\">Allied nations</span> cannot be attacked while the alliance lasts.",
        "<strong>Trade</strong> only works with allies.",
        "<em>Ceasefires</em> pause attacks without fully ending the war state."
      ],
      cards: [
        {
          icon: "/UI_Icons/Expressions/allied.png",
          title: "Alliance",
          description: "Lets both sides cooperate, blocks attacks, and unlocks trade offers."
        },
        {
          icon: "/UI_Icons/Expressions/ceasefire.png",
          title: "Ceasefire",
          description: "Temporarily pauses attacks so both sides can recover or reposition."
        },
        {
          icon: "/UI_Icons/Expressions/war.png",
          title: "War",
          description: "Required for hostile land attacks, hostile transports, and most direct pressure."
        },
        {
          icon: "/UI_Icons/Expressions/Crown.png",
          title: "Intel",
          description: "Use intel to inspect another nation before deciding whether to ally, trade, or attack."
        }
      ]
    },
    {
      badge: "Trade",
      title: "Resources, Trade, and Oil Supply",
      summary: "<strong>Food</strong>, <strong>Steel</strong>, and <strong>Oil</strong> keep your nation growing and your advanced buildings running.",
      icons: [
        { src: "/UI_Icons/TradeResources/Food.png", label: "Food" },
        { src: "/UI_Icons/TradeResources/Steel.png", label: "Steel" },
        { src: "/UI_Icons/TradeResources/Oil.png", label: "Oil" },
        { src: "/Structures/ShipIcons/TradeShip.png", label: "Trade" }
      ],
      paragraphs: [
        "Cities produce food, factories produce steel, and coastal rigs produce oil. Those three resources quietly shape your whole match even when the frontline looks calm.",
        "<strong>Food</strong> supports population growth and troop recovery. <strong>Steel</strong> is spent on structures. <strong>Oil</strong> powers advanced military infrastructure and vehicle launches. If oil dries up, oil-using structures can stop working."
      ],
      bullets: [
        "<strong>Food shortages</strong> slow growth and reinforcements.",
        "<strong>Steel</strong> is required for construction.",
        "<strong>Oil</strong> powers ports, airbases, missile silos, ABM launchers, and vehicle launches.",
        "<span class=\"guideToneRed\">War</span> immediately cancels trade between former partners."
      ],
      cards: [
        {
          icon: "/UI_Icons/TradeResources/Food.png",
          title: "Food",
          description: "Keeps population growth and troop recovery healthy."
        },
        {
          icon: "/UI_Icons/TradeResources/Steel.png",
          title: "Steel",
          description: "The build material for nearly every serious structure plan."
        },
        {
          icon: "/UI_Icons/TradeResources/Oil.png",
          title: "Oil",
          description: "Critical for advanced military systems and for keeping key structures online."
        },
        {
          icon: "/Structures/ShipIcons/TradeShip.png",
          title: "Trade",
          description: "Trade deals exchange resources over time, but only between active allies."
        }
      ]
    },
    {
      badge: "Research",
      title: "Researching New Upgrades",
      summary: "<strong>Cities</strong> and <strong>Research Labs</strong> generate <span class=\"guideToneBlue\">Research Points</span> you spend on permanent bonuses.",
      icons: [
        { src: "/UI_Icons/ResearchPoints.png", label: "Research Points" },
        { src: "/ResearchIcons/eco_tax_efficiency.png", label: "Economy" },
        { src: "/ResearchIcons/mil_nuclear_research.png", label: "Military" }
      ],
      paragraphs: [
        "<span class=\"guideToneBlue\">Research Points</span> come in over time from cities and Research Labs. Spend those points to start nodes that unlock permanent bonuses or new military options.",
        "There are three branches: <strong>Economy</strong>, <strong>Military</strong>, and <strong>Infrastructure</strong>. You can only run one active node at a time in each branch, and higher tiers usually need earlier nodes first."
      ],
      bullets: [
        "<strong>Economy</strong> improves <span class=\"guideToneGold\">Gold</span> income, food output, and long-run stability.",
        "<strong>Military</strong> improves barracks, defence, casualty recovery, and nuclear weapons.",
        "<strong>Infrastructure</strong> improves build speed, stack limit, city cap, ports, and warships.",
        "<span class=\"guideToneBlue\">Research</span> is a long-term advantage, not a panic button."
      ],
      cards: [
        {
          icon: "/UI_Icons/ResearchPoints.png",
          title: "Research Points",
          description: "Your currency for starting new nodes in the tech tree."
        },
        {
          icon: "/ResearchIcons/eco_tax_efficiency.png",
          title: "Economy Branch",
          description: "Best for stronger income, food output, and a smoother late game."
        },
        {
          icon: "/ResearchIcons/mil_nuclear_research.png",
          title: "Military Branch",
          description: "Boosts land warfare and eventually unlocks your nuclear path."
        },
        {
          icon: "/ResearchIcons/inf_warships.png",
          title: "Infrastructure Branch",
          description: "Adds warships, faster building, bigger structure stacks, and better logistics."
        }
      ]
    },
    {
      badge: "Build Menu",
      title: "What Each Structure Does",
      summary: "Each structure fills a <strong>specific role</strong>, and strong nations mix them instead of spamming only one.",
      icons: [
        { src: "/Structures/city.png", label: "City" },
        { src: "/Structures/factory.png", label: "Factory" },
        { src: "/Structures/port.png", label: "Port" },
        { src: "/Structures/airbase.png", label: "Airbase" }
      ],
      paragraphs: [
        "Most structures must be placed inside your own territory. <strong>Ports</strong> must touch water, and <strong>Coastal Rigs</strong> must sit in a clear ocean area. Build costs rise as you own more of the same type, so your choices matter.",
        "Basic structures can stack on the same anchor tile, but advanced military structures like <span class=\"guideToneRed\">Missile Silos</span>, ABM Launchers, Airbases, and Coastal Rigs stay one per spot."
      ],
      bullets: [
        "<strong>Cities</strong> expand population cap and food support.",
        "<strong>Factories</strong> fund industry and steel production.",
        "<strong>Barracks</strong> train infantry, while <strong>Defence Posts</strong> harden key ground.",
        "<span class=\"guideToneBlue\">Research Labs</span>, Ports, Airbases, and missile systems support higher-tech play."
      ],
      cards: [
        {
          icon: "/Structures/city.png",
          title: "City",
          description: "Population cap, food support, and steady civic income."
        },
        {
          icon: "/Structures/factory.png",
          title: "Factory",
          description: "Industrial money and steel for sustained growth."
        },
        {
          icon: "/Structures/barracks.png",
          title: "Barracks",
          description: "Passive infantry production for expansion and war."
        },
        {
          icon: "/Structures/defence_post.png",
          title: "Defence Post",
          description: "Best used to hold borders, capitals, and narrow fronts."
        },
        {
          icon: "/Structures/port.png",
          title: "Port",
          description: "Your gateway to trade, warships, and long-range transport plays."
        },
        {
          icon: "/Structures/coastal_rig.png",
          title: "Coastal Rig",
          description: "Main oil building. Excellent if you want fleets, silos, or air power."
        },
        {
          icon: "/UI_Icons/ResearchPoints.png",
          title: "Research Lab",
          description: "Your strongest direct source of research income."
        },
        {
          icon: "/Structures/airbase.png",
          title: "Airbase",
          description: "Builds transport planes for airborne operations."
        }
      ]
    },
    {
      badge: "Sea Power",
      title: "Ports, Trade Ships, Warships, and Naval Transports",
      summary: "<strong>Ports</strong> connect you to the sea and let you project power across water.",
      icons: [
        { src: "/Structures/port.png", label: "Port" },
        { src: "/Structures/ShipIcons/TradeShip.png", label: "Trade Ship" },
        { src: "/Structures/ShipIcons/WarShip.png", label: "Warship" },
        { src: "/Structures/ShipIcons/TransportShip.png", label: "Transport Ship" }
      ],
      paragraphs: [
        "Ports are more than decoration. They support trade routes, let you send <strong>Warships</strong> into the ocean, and launch transports that can open entirely new fronts across water.",
        "<strong>Warships</strong> are not available immediately. You need the Warships research from the Infrastructure branch first. After that, ports become much more dangerous for your enemies."
      ],
      bullets: [
        "<strong>Trade Ships</strong> help ports turn sea access into <span class=\"guideToneGold\">Gold</span>.",
        "<strong>Warships</strong> hunt enemy ships and can destroy coastal rigs.",
        "<strong>Naval transports</strong> let you expand or attack across water.",
        "<em>Sea control</em> matters more on maps with islands, long coasts, or separated fronts."
      ],
      cards: [
        {
          icon: "/Structures/port.png",
          title: "Port",
          description: "Supports trade, warships, and long-range transport plays."
        },
        {
          icon: "/Structures/ShipIcons/TradeShip.png",
          title: "Trade Ship",
          description: "A passive economic route that rewards safe maritime access."
        },
        {
          icon: "/Structures/ShipIcons/WarShip.png",
          title: "Warship",
          description: "A mobile sea raider that punishes enemy shipping and exposed rigs."
        },
        {
          icon: "/Structures/ShipIcons/TransportShip.png",
          title: "Transport",
          description: "Carries troops to overseas neutral land or enemy coasts."
        }
      ]
    },
    {
      badge: "Air Power",
      title: "Airbases and Airborne Drops",
      summary: "<strong>Airbases</strong> let you build transport planes and drop troops deep into distant land.",
      icons: [
        { src: "/Structures/airbase.png", label: "Airbase" },
        { src: "/Structures/PlaneIcon/transportPlane.png", label: "Transport Plane" },
        { src: "/UI_Icons/infantry.png", label: "Infantry" },
        { src: "/UI_Icons/TradeResources/Oil.png", label: "Oil" }
      ],
      paragraphs: [
        "Airbases build transport planes one at a time. Once a plane is ready, you can launch it at land inside range and drop infantry there.",
        "Airborne missions need enough free infantry and <strong>Oil</strong> to launch. They are perfect for island grabs, backline pressure, or opening a second front where the enemy feels safe."
      ],
      bullets: [
        "<strong>Transport planes</strong> can target neutral or hostile land.",
        "<strong>Launching</strong> needs oil and enough free infantry.",
        "<span class=\"guideToneRed\">Airborne landings</span> can start wars if they strike enemy territory.",
        "Use air drops to bypass hard frontlines or reach remote regions fast."
      ],
      cards: [
        {
          icon: "/Structures/airbase.png",
          title: "Airbase",
          description: "Holds and builds transport planes for long-range drops."
        },
        {
          icon: "/Structures/PlaneIcon/transportPlane.png",
          title: "Transport Plane",
          description: "A one-shot airborne tool that carries a chunk of infantry into the drop zone."
        },
        {
          icon: "/UI_Icons/infantry.png",
          title: "Dropped Troops",
          description: "Captured landing tiles depend on how many troops survive and how much resistance they meet."
        },
        {
          icon: "/UI_Icons/TradeResources/Oil.png",
          title: "Fuel Cost",
          description: "Airborne power is strong, but oil keeps it honest."
        }
      ]
    },
    {
      badge: "Strategic",
      title: "Missile Silos, Warheads, and ABM Defense",
      summary: "<strong>Late-game missile systems</strong> can break stalemates or protect your core.",
      icons: [
        { src: "/Structures/missile_silo.png", label: "Missile Silo" },
        { src: "/UI_Icons/AtomicMissile.png", label: "Atomic" },
        { src: "/UI_Icons/HydrogenMissile.png", label: "Hydrogen" },
        { src: "/Structures/abm_launcher.png", label: "ABM" }
      ],
      paragraphs: [
        "<strong>Missile Silos</strong> are locked behind Nuclear Research in the Military branch. After that, later military research unlocks Atomic Bombs and then Hydrogen Bombs.",
        "Silos build warheads over time before they are ready to launch. <strong>ABM Launchers</strong> create missile defense around important regions and can intercept incoming strikes if they are in position."
      ],
      bullets: [
        "<span class=\"guideToneBlue\">Research Nuclear Research</span> to unlock Missile Silos.",
        "<span class=\"guideToneRed\">Atomic</span> and <span class=\"guideToneRed\">Hydrogen</span> bombs each need their own later research.",
        "<strong>Missile Silos</strong> and ABM Launchers need oil to stay operational.",
        "Use missile defense around capitals, dense cores, or key military zones."
      ],
      cards: [
        {
          icon: "/Structures/missile_silo.png",
          title: "Missile Silo",
          description: "Builds and launches your strategic warheads once unlocked."
        },
        {
          icon: "/UI_Icons/AtomicMissile.png",
          title: "Atomic Bomb",
          description: "The first nuclear step. Strong enough to punish clusters and soft targets."
        },
        {
          icon: "/UI_Icons/HydrogenMissile.png",
          title: "Hydrogen Bomb",
          description: "The heavier endgame strike for larger devastation."
        },
        {
          icon: "/UI_Icons/abmMissile.png",
          title: "ABM Defense",
          description: "Your main answer to enemy missiles when placed near what matters."
        }
      ]
    },
    {
      badge: "Endgame",
      title: "Capital Capture, Collapse, and Winning",
      summary: "Taking a <strong>Capital</strong> causes a collapse, but a collapsed nation can still survive for a while.",
      icons: [
        { src: "/Structures/capital.png", label: "Capital" },
        { src: "/UI_Icons/stability.png", label: "Collapse" },
        { src: "/UI_Icons/Expressions/victory.png", label: "Victory" }
      ],
      paragraphs: [
        "<strong>Capital capture</strong> is a huge turning point. It weakens the losing nation hard, but it does not always erase them on the spot. A collapsed nation can still hold out and may recover if you stop pressing.",
        "That means <em>finishing power</em> matters. If an enemy collapses, keep the pressure on. If you collapse, buy time, rebuild, and protect what is left."
      ],
      bullets: [
        "<span class=\"guideToneRed\">Collapsed nations</span> are wounded, not instantly removed.",
        "<span class=\"guideToneGreen\">A surviving nation</span> can recover from collapse.",
        "<strong>Protect your capital</strong> with terrain depth, Defence Posts, and strategic defenses.",
        "<span class=\"guideToneGold\">Victory</span> comes when all opposing nations are finally eliminated."
      ],
      cards: [
        {
          icon: "/Structures/capital.png",
          title: "Capital Loss",
          description: "One of the most dangerous events in the match and often the start of a collapse."
        },
        {
          icon: "/UI_Icons/stability.png",
          title: "Collapse",
          description: "A collapsed nation becomes weaker, but it is still part of the game until finished off."
        },
        {
          icon: "/UI_Icons/Expressions/victory.png",
          title: "Recovery",
          description: "If left alone, a collapsed nation can climb back into the fight."
        },
        {
          icon: "/UI_Icons/Expressions/Crown.png",
          title: "Victory",
          description: "The last surviving nation standing wins the map."
        }
      ]
    }
  ]
};

function text(value, fallback = "") {
  const raw = String(value ?? "").trim();
  return raw || fallback;
}

function setRichText(node, value, fallback = "") {
  if (!node) return;
  node.innerHTML = text(value, fallback);
}

function clearChildren(node) {
  if (!node) return;
  while (node.firstChild) node.removeChild(node.firstChild);
}

function createIconFigure(item, className = "mainMenuGuideIconChip", tagName = "div") {
  const src = text(item?.src);
  if (!src) return null;
  const figure = document.createElement(tagName);
  figure.className = className;

  const img = document.createElement("img");
  img.className = `${className}Image`;
  img.src = src;
  img.alt = text(item?.label, "");
  img.loading = "lazy";
  img.decoding = "async";
  img.draggable = false;
  figure.appendChild(img);

  return figure;
}

function appendParagraphs(parent, paragraphs) {
  const items = Array.isArray(paragraphs) ? paragraphs : [];
  for (const item of items) {
    const value = text(item);
    if (!value) continue;
    const p = document.createElement("p");
    p.className = "mainMenuGuideBodyCopy";
    setRichText(p, value);
    parent.appendChild(p);
  }
}

function appendBullets(parent, bullets) {
  const items = Array.isArray(bullets) ? bullets.map((item) => text(item)).filter(Boolean) : [];
  if (!items.length) return;
  const list = document.createElement("ul");
  list.className = "mainMenuGuideBulletList";
  for (const item of items) {
    const li = document.createElement("li");
    setRichText(li, item);
    list.appendChild(li);
  }
  parent.appendChild(list);
}

function appendSectionIcons(parent, icons) {
  const items = Array.isArray(icons) ? icons.slice(0, 6) : [];
  if (!items.length) return;

  const row = document.createElement("div");
  row.className = "mainMenuGuideSimpleIconRow";

  for (const item of items) {
    const chip = document.createElement("div");
    chip.className = "mainMenuGuideSimpleIconChip";

    const icon = createIconFigure(item, "mainMenuGuideSimpleIcon");
    if (icon) chip.appendChild(icon);

    const label = document.createElement("span");
    label.className = "mainMenuGuideSimpleIconLabel";
    label.textContent = text(item?.label, "Icon");
    chip.appendChild(label);

    row.appendChild(chip);
  }

  parent.appendChild(row);
}

function createSection(section, index) {
  const article = document.createElement("article");
  article.className = "mainMenuGuideSection";
  const isOpen = !!(section?.open || index === 0);
  article.classList.toggle("isOpen", isOpen);

  const toggle = document.createElement("button");
  toggle.className = "mainMenuGuideSimpleToggle";
  toggle.type = "button";
  toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");

  const title = document.createElement("span");
  title.className = "mainMenuGuideSimpleTitle";
  title.textContent = text(section?.title, "Untitled Section");
  toggle.appendChild(title);

  const chevron = document.createElement("span");
  chevron.className = "mainMenuGuideSimpleChevron";
  chevron.setAttribute("aria-hidden", "true");
  toggle.appendChild(chevron);
  article.appendChild(toggle);

  const panel = document.createElement("div");
  panel.className = "mainMenuGuideSimplePanel";
  panel.setAttribute("aria-hidden", isOpen ? "false" : "true");
  panel.hidden = !isOpen;

  const body = document.createElement("div");
  body.className = "mainMenuGuideSimpleBody";
  const summary = text(section?.summary);
  if (summary) {
    const lead = document.createElement("p");
    lead.className = "mainMenuGuideSimpleLead";
    setRichText(lead, summary);
    body.appendChild(lead);
  }
  appendSectionIcons(body, section?.icons);
  appendParagraphs(body, section?.paragraphs);
  appendBullets(body, section?.bullets);
  if (Array.isArray(section?.cards) && section.cards.length) {
    const extraBullets = document.createElement("ul");
    extraBullets.className = "mainMenuGuideBulletList";
    for (const card of section.cards) {
      const name = text(card?.title, "Feature");
      const desc = text(card?.description);
      if (!name && !desc) continue;
      const li = document.createElement("li");
      setRichText(li, desc ? `<strong>${name}</strong>: ${desc}` : name);
      extraBullets.appendChild(li);
    }
    if (extraBullets.childElementCount) body.appendChild(extraBullets);
  }
  panel.appendChild(body);
  article.appendChild(panel);

  toggle.addEventListener("click", () => {
    const nextOpen = !article.classList.contains("isOpen");
    article.classList.toggle("isOpen", nextOpen);
    toggle.setAttribute("aria-expanded", nextOpen ? "true" : "false");
    panel.setAttribute("aria-hidden", nextOpen ? "false" : "true");
    panel.hidden = !nextOpen;
  });

  return article;
}

export function renderMainMenuGuide(elements, data = MAIN_MENU_GUIDE) {
  const refs = (elements && typeof elements === "object") ? elements : {};
  const model = (data && typeof data === "object") ? data : MAIN_MENU_GUIDE;
  const highlights = Array.isArray(model.heroHighlights) ? model.heroHighlights : [];
  const sections = Array.isArray(model.sections) ? model.sections : [];

  if (refs.eyebrow) refs.eyebrow.textContent = text(model.eyebrow, "Field Manual");
  if (refs.title) refs.title.textContent = text(model.title, "Game Guide");
  if (refs.heroBadge) refs.heroBadge.textContent = text(model.heroBadge, "Guide");
  if (refs.heroTitle) refs.heroTitle.textContent = text(model.heroTitle, "How PixelFront Works");
  if (refs.heroSummary) {
    setRichText(
      refs.heroSummary,
      model.heroSummary,
      "Open any section below and read only the systems you need."
    );
  }

  if (refs.heroHighlights) {
    clearChildren(refs.heroHighlights);
    for (const item of highlights) {
      const chip = document.createElement("div");
      chip.className = "mainMenuGuideHighlight";
      const icon = createIconFigure(item, "mainMenuGuideHighlightIcon");
      if (icon) chip.appendChild(icon);
      const label = document.createElement("span");
      label.textContent = text(item?.label, "Highlight");
      chip.appendChild(label);
      refs.heroHighlights.appendChild(chip);
    }
  }

  if (refs.sections) {
    clearChildren(refs.sections);
    for (let i = 0; i < sections.length; i++) {
      refs.sections.appendChild(createSection(sections[i], i));
    }
  }
}
