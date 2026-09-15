# Metronom + Tour Tempo

Metronom do prohlížeče se dvěma režimy: klasický hudební metronom a golfový režim
s tříbodovým odpočtem švihu (start nápřahu → vrchol → úder).

Celá aplikace je v jednom souboru `index.html`, nepotřebuje server ani internet.

## Nahrání na GitHub

1. Na GitHubu vytvoř nové **veřejné** repository, třeba `metronom`.
2. Nahraj do něj tyto soubory (Add file → Upload files → Commit):
   - `index.html`
   - `manifest.webmanifest`
   - `sw.js`
   - `icon-180.png`, `icon-192.png`, `icon-512.png`
3. V repository jdi do **Settings → Pages**.
4. V sekci *Build and deployment* nastav **Source: Deploy from a branch**,
   branch `main` a složku `/ (root)`. Ulož.
5. Za minutu až dvě bude adresa `https://TVUJ-UCET.github.io/metronom/`.

Repository musí být veřejné, jinak GitHub Pages na free účtu nefunguje.

## Uložení na plochu iPhonu

1. Otevři tu adresu **v Safari** (v Chromu ani v jiném prohlížeči to na iOS nejde).
2. Ťukni na ikonu sdílení (čtvereček se šipkou nahoru).
3. Sjeď dolů na **Přidat na plochu** a potvrď.

Ikona se objeví na ploše a aplikace se spustí na celou obrazovku bez adresního řádku.
Po prvním spuštění se obsah uloží do telefonu, takže funguje i v letadle nebo
na driving range bez signálu.

## Aktualizace

Když soubor `index.html` změníš, zvyš i číslo v `sw.js`:

```js
const VERSION = "metronom-v2";
```

Bez toho si telefon nechá starou verzi z cache. Po nahrání na GitHub aplikaci
na iPhonu jednou zavři a znovu otevři, případně dvakrát.

## Poznámka k číslům v golfovém režimu

Čísla jako `24/8` znamenají počet snímků videa při 30 fps: 24 snímků nápřah
(0,80 s) a 8 snímků dopad (0,27 s), tedy poměr 3:1 — to je hodnota z výzkumu
Johna Novosela (Tour Tempo). Krátká hra a putt používají poměr 2:1.

Předvolba `24/14` má poměr 1,73:1 a odpovídá tomu, co je slyšet v některých
videích na YouTube. Ta videa jsou zpomalená a jejich tóny neodpovídají
skutečnému poměru 3:1 — je to tam znatelně pomalejší dopad.

Tour Tempo je ochranná známka svých vlastníků; tahle aplikace s nimi nijak
nesouvisí a tóny jsou syntetizované.
