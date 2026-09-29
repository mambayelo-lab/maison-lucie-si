# Maison Lucie : SI de test multi-sources

Maison Lucie simule le SI d'un distributeur avec 5 sources indépendantes, chacune avec ses propres clés et ses propres erreurs. Il sert à tester la couche d'intégration d'Aura : connexion, métadonnées, mapping, rapprochement, cohérence et alertes.

## Les 5 sources

Toutes les ressources demandent l'en-tête `Authorization: Bearer <jeton passerelle>`. Le jeton public de démonstration est `lucie_aura_gateway_demo_token`, surchargeable par `LUCIE_GATEWAY_TOKEN`. Le catalogue est servi par `GET /api/sources/index`, sans authentification.

| Source | Rôle | Accès | Clés propres |
|---|---|---|---|
| SAP S/4HANA | maître fournisseurs, commandes d'achat | OData v2 : `/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_Supplier`, `/sap/opu/odata/sap/API_PURCHASEORDER_PROCESS_SRV/A_PurchaseOrderItem` | LIFNR (`0000100001`) |
| PIM | maître produits | REST : `/api/sources/pim?resource=products` | productId, EAN-13, identifiant fiscal fournisseur en saisie libre |
| Manhattan Active WM | stock, expéditions, sites | REST : `/api/sources/manhattan?resource=inventory` (ou `shipments`, `facilities`) | ItemId en GTIN-14, FacilityId sans tiret (`WHPAR`) |
| OMS | commandes clients | REST : `/api/sources/oms?resource=order-lines` ; fichier : `&format=csv` | référence interne (casse libre), OrderLineId |
| Data lake | historique des ventes | CSV : `/api/sources/lake?resource=sales&format=csv` ; agrégats : `?aggregate=1&groupBy=Ean,month&from=…&to=…` | EAN-13, code magasin (`btq_par_fsh`) |

Chaque interface a ses paramètres :

- **SAP (OData v2)** :
  - `$filter` (`eq`, `ne`, `gt`, `ge`, `lt`, `le`, `and`, `datetime'…'`) ;
  - `$select`, `$top`, `$skip`, `$inlinecount=allpages` ;
  - pagination `__next` ;
  - delta : `__delta` en fin de lecture, puis `!deltatoken=<horodatage>` ;
  - `$metadata` (EDMX) : `/sap/opu/odata/sap/<service>/$metadata`.
- **REST** :
  - `updatedAfter` ;
  - pagination par curseur (`limit`, `cursor`, `nextCursor`), ou page/size pour Manhattan (`page`, `size`, `header.hasMore`) ;
  - fenêtre temporelle `from` et `to` ;
  - filtre d'égalité sur tout champ.

## Deux tailles, un seul générateur

`lib/multisource-gen.js` calcule chaque ligne à partir de son seul rang, avec une graine fixe. Le même code sert :

- à la **taille démo** (`npm run generate:demo`), écrite dans `data/multisource-demo.json`, versionnée et servie en ligne avec tous les filtres ;
- aux **API à grande échelle**, en ajoutant `size=scale` à toute ressource. Les millions de lignes sont générés à la volée, page par page (5 000 lignes au plus). Rien n'est stocké ni sur git ni sur Vercel. Seule la pagination est offerte ; `$filter`, `updatedAfter` et `aggregate` renvoient 400 ;
- au **Parquet** (`npm run generate:scale`), qui écrit dans `/tmp/maison-lucie-scale` (230 s, 520 Mo). Le lac y est partitionné par mois.

La génération Parquet utilise la même logique écrite en SQL DuckDB (`scripts/multisource-sql.mjs`, hachage `h32` identique). `scripts/test-generator-equivalence.mjs` vérifie que JavaScript et SQL donnent exactement les mêmes lignes, table par table.

| Table | Démo | Scale |
|---|---|---|
| sap_suppliers | 63 | 5 025 |
| sap_purchase_orders | 800 | 1 000 000 |
| pim_products | 1 200 | 1 000 000 |
| wms_facilities | 12 | 500 |
| wms_stock | 3 600 | 5 000 000 |
| wms_shipments | 800 | 1 000 000 |
| oms_order_lines | 3 000 | 10 000 000 |
| lake_sales | 4 000 | 50 000 000 |

## Erreurs volontaires

Les erreurs sont injectées par des règles déterministes. La vérité terrain est recalculée à chaque génération, dans le champ `groundTruth` du JSON ou du manifeste.

| Erreur | Source | Démo | Scale | Ce qu'Aura doit faire |
|---|---|---|---|---|
| Fournisseur en double (autre LIFNR, raison sociale en majuscules + « SAS », SIRET ou TVA espacés) | SAP | 3 | 25 | détecter le doublon par clé fiscale normalisée |
| Produit au fournisseur inconnu (identifiant fiscal `FR99…`) | PIM | 6 | 3 003 | orphelin du lien produit → fournisseur |
| EAN en double | PIM | 4 | 2 000 | conflit : aucun rattachement arbitraire |
| TVA en minuscules avec espaces, DUNS avec tirets | PIM | — | — | normaliser |
| GTIN inconnu (préfixe `0399`) | Manhattan | 5 | 5 000 | orphelin |
| Site `WHXXX` inconnu | Manhattan | 2 | 1 000 | orphelin |
| GTIN-14 et FacilityId sans tiret | Manhattan | — | — | normaliser (EAN-13, `WH-PAR`) |
| Raison sociale variante (`TESSITURA MILANO Ltd`) | Manhattan | 8 | 4 368 | ressemblance en file de validation, jamais appliquée seule |
| Référence en minuscules | OMS | 60 | 200 000 | normaliser |
| Code magasin `btq_par_fsh` | lac | — | — | normaliser |
| Pays fournisseur différent de SAP | PIM | 3 | 218 | écart de fond, signalé dans la preuve des alertes |
| Commande `PO-4500000001` (WMS) contre `4500000001` (SAP) | Manhattan | — | — | normaliser |

## Récit de démonstration

Le récit reprend les 15 fournisseurs et les 20 articles des alertes existantes (`SUP-001` Tessitura Milano, `CLASP-AURORA`…). Tessitura Milano et Shenzhen Atelier Components ont un taux de retard élevé, et des articles du récit sont en rupture sur un site. Les alertes existantes (`ALT-*`, jeux `lib/demo-data.js`) sont inchangées et restent reproductibles.

## Tests

```bash
npm run test:multisource   # contrats OData/REST/lac, erreurs volontaires, taille scale à la volée, $metadata, équivalence JS/SQL
npm test                   # tous les tests (le smoke test demande le serveur local : npm start)
```
