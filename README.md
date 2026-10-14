# Metronom + Tour Tempo

Metronom pro hudební cvičení a trenažér tempa golfového švihu v jedné appce.
Běží celá v prohlížeči, funguje offline a data zůstávají jen v telefonu.

## Co umí

**Metronom**
- Tempo 30–260 úderů za minutu: posuvník, tlačítka + / − (jde držet), ťukání tempa
- Takt 1–12 dob s přízvukem na první době
- Dělení doby na osminy, trioly a šestnáctiny, plynulý swing až po triolový feel
- Šest zvuků včetně tónů Tour Tempo
- Postupné zrychlování (+X úderů po Y taktech až do stropu)
- Tiché takty — metronom počítá dál, ale mlčí
- Vlastní předvolby

**Golfový švih**
- Tři tóny: start nápřahu → vrchol → úder do míčku
- Předvolby plné hry 3:1 (18/6 až 33/11) a krátké hry 2:1 (14/7 až 22/11)
- Vlastní poměr a délka nápřahu po jednotlivých snímcích
- **Náhodné kolísání pauzy** — abys tóny nezačal předvídat
- Počítadlo švihů a volitelný cíl na sezení
- Vlastní předvolby

**Statistiky**
- Sezení se zapisují samy, nic nemusíš mačkat
- Švihy a minuty cvičení za 7 / 30 dní / celkem, série dní v řadě
- Graf aktivity po dnech, nejčastější tempa, seznam posledních sezení

**Ostatní**
- Světlý a tmavý motiv (na slunci se hodí světlý)
- Displej nezhasne, dokud metronom běží
- Export a import zálohy, smazání všech dat
- Klávesové zkratky na počítači: `mezerník` start, `↑` `↓` tempo, `T` ťuknutí tempa

## 1. Nahrání na GitHub

**Přes web (bez instalace čehokoliv):**
1. Na github.com vpravo nahoře **+ → New repository**, zadej název (např. `metronom`),
   nech **Public** a klikni **Create repository**.
2. Klikni **uploading an existing file**, přetáhni **obsah** rozbalené složky
   (ne složku samotnou — `index.html` musí být v kořeni repa) a dej **Commit changes**.

**Přes git:**

    git init && git add . && git commit -m "Initial commit"
    git branch -M main
    git remote add origin https://github.com/TVOJE-JMENO/metronom.git
    git push -u origin main

## 2. Zapnutí GitHub Pages

1. V repu **Settings → Pages**.
2. **Source: Deploy from a branch**, **Branch: main**, složka **/ (root)** → **Save**.
3. Za 1–2 minuty bude appka na `https://TVOJE-JMENO.github.io/metronom/`
   (odkaz se objeví nahoře na stránce Pages).

Na bezplatném účtu musí být repo **Public**. Data appky se na GitHub neukládají —
zůstávají jen v tvém telefonu.

## 3. Přidání na plochu telefonu

- **iPhone:** otevři odkaz v **Safari** → tlačítko **Sdílet** (čtvereček se šipkou)
  → **Přidat na plochu** → **Přidat**.
- **Android:** otevři odkaz v **Chrome** → menu **⋮** → **Instalovat aplikaci**.

Appka se pak spouští z ikony na celou obrazovku a funguje i bez internetu.

Pozor: na iPhonu má appka na ploše **oddělené úložiště od Safari**. Co nastavíš
v Safari před instalací, se do nainstalované appky nepřenese — nastav si ji až
po přidání na plochu.

## 4. Aktualizace appky

Nahraj změněné soubory do repa (**Add file → Upload files**, přepiš je) a
v `sw.js` zvyš `VERSION` na `v2`, `v3` a tak dál. Bez toho si telefon nechá
starou verzi z cache. Po nahrání appku zavři a znovu otevři, někdy dvakrát.

## 5. Záloha dat

V appce **Nastavení → Data → Exportovat zálohu**. Zálohuj hlavně před výměnou
telefonu nebo než smažeš data prohlížeče. Obnova: **Importovat zálohu**
(jde vrátit tlačítkem Zpět, pokud se spleteš).

## Co znamenají čísla v golfovém režimu

Čísla jako `24/8` jsou počty snímků videa při 30 snímcích za sekundu: 24 snímků
nápřah (0,80 s) a 8 snímků dopad (0,27 s), tedy poměr 3:1. To číslo pochází
z analýzy švihů hráčů na PGA Tour, kterou publikoval John Novosel v knize
Tour Tempo. Krátká hra a putt používají poměr 2:1.

Předvolba `24/14` má poměr 1,73:1 a odpovídá tomu, co je slyšet v některých
zpomalených videích na YouTube — jejich tóny jsou nalepené na zpomalený záběr,
takže mají nápadně delší dopad než skutečné tourové tempo.

Měření při 60 snímcích za sekundu později ukázalo rozptyl zhruba 2,25:1 až 3,25:1,
takže 3:1 je střed, ne pevné pravidlo.

## Data a soukromí

Appka ukládá jen tvoje nastavení, předvolby a záznamy sezení, a to výhradně
do úložiště prohlížeče v tomhle zařízení. Nevolá žádné cizí servery, nepoužívá
analytiku ani reklamu, takže nepotřebuje ani souhlas s cookies. Pokud ji hostuješ
na GitHub Pages, GitHub jako provozovatel hostingu zpracovává při načtení stránky
technické údaje včetně IP adresy.

Appka nenahrazuje trenéra ani lékařskou radu.
