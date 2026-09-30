# Maison Lucie : SI de test multi-sources

Maison Lucie simule le SI d'un distributeur avec 9 applications indépendantes (plus un SIRH simulé pour l'absentéisme), chacune avec ses propres clés et ses propres erreurs. Il sert à tester la couche d'intégration d'Aura : connexion, métadonnées, mapping, rapprochement, cohérence et alertes.

## Le paysage applicatif (9 applications)

Toutes les ressources demandent l'en-tête `Authorization: Bearer <jeton passerelle>`. Le jeton public de démonstration est `lucie_aura_gateway_demo_token`, surchargeable par `LUCIE_GATEWAY_TOKEN`. Le catalogue est servi par `GET /api/sources/index`, sans authentification.

| Application | Rôle | Accès | Clés propres |
|---|---|---|---|
| ERP · SAP S/4HANA | achats, fournisseurs, finance (maître fournisseurs) | OData v2 : `/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_Supplier`, `…/API_PURCHASEORDER_PROCESS_SRV/A_PurchaseOrderItem` | LIFNR (`0000100001`), EBELN |
| PIM | référentiel produit (maître produits) | REST : `/api/sources/pim?resource=products` | productId, EAN-13, identifiant fiscal fournisseur en saisie libre |
| WMS · Manhattan Active WM | stocks, entrepôts | REST : `/api/sources/manhattan?resource=inventory` (ou `facilities`) | ItemId en GTIN-14, FacilityId sans tiret (`WHPAR`) |
| TMS | transport, expéditions, transporteurs | REST : `/api/sources/tms?resource=shipments` | ShipmentId, `PO-…`, raison sociale libre, transporteur, mode |
| APS | planification, prévisions, S&OP | REST : `/api/sources/aps?resource=forecasts` | référence interne + site + semaine ISO |
| SRM · portail fournisseurs | évaluation, risques, certifications | REST : `/api/sources/srm?resource=suppliers` | SrmId, TVA « FR-12-… » ou DUNS |
| QMS | qualité, non-conformités, retours | REST : `/api/sources/qms?resource=nonconformities` | NcId, EAN, identifiant fiscal fournisseur |
| OMS | commandes clients | REST : `/api/sources/oms?resource=order-lines` ; fichier : `&format=csv` | référence interne (casse libre), OrderLineId |
| Data lake | historique des ventes | CSV : `/api/sources/lake?resource=sales&format=csv` ; agrégats : `?aggregate=1&groupBy=Ean,month` | EAN-13, code magasin (`btq_par_fsh`) |

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

## Schéma du SI : applications, flux et maîtres

```mermaid
flowchart LR
  PIM[PIM · maître articles] -->|articles| ERP[ERP SAP · maître fournisseurs, achats, finance]
  PIM -->|articles| APS[APS · prévisions, S&OP]
  PIM -->|articles| WMS[WMS Manhattan · maître stocks, sites]
  PIM -->|articles| OMS[OMS · maître commandes clients]
  ERP -->|fournisseurs| SRM[SRM · risques, certifications]
  ERP -->|fournisseurs| QMS[QMS · non-conformités, retours]
  ERP -->|commandes d'achat| TMS[TMS · expéditions, livraisons]
  OMS -->|mouvements| WMS
  OMS -->|livraisons| TMS
  APS -->|prévisions| WMS
  OMS & WMS & ERP & TMS & APS & QMS -->|J-1, mêmes identifiants| LAKE[(Data lake)]
```

| Domaine | Application maître | Applications qui le reprennent (même identifiant, normalisé) |
|---|---|---|
| Article | PIM (EAN, référence interne) | ERP (Material), WMS (GTIN-14), OMS (ProductRef), APS (Material), QMS (EAN), data lake (EAN) |
| Fournisseur | ERP SAP (LIFNR, SIRET/TVA/DUNS) | SRM (TaxId), QMS (SupplierTaxId), PIM (supplierTaxId), TMS (raison sociale) |
| Site | WMS (FacilityId) | OMS (FulfillmentSite), APS (Site), data lake (StoreCode) |
| Stock et mouvements | WMS | data lake (J-1) |
| Commande client | OMS | WMS (mouvements), TMS (livraisons), data lake (J-1) |
| Commande d'achat, expédition | ERP, TMS | data lake (J-1) |
| Prévision | APS | data lake (J-1) |
| Qualité | QMS | data lake (J-1) |

Le data lake est alimenté par les applications : flux `orders`, `stock`, `movements`, `purchases`, `transport`, `deliveries`, `forecasts` et `quality` (`/api/sources/lake?resource=<flux>`). Chaque ligne est une copie de la ligne d'origine, avec son application (`_source`) et une heure d'ingestion décalée d'un jour (`_ingestedAt`, J-1) ; les lignes plus récentes que J-1 n'y sont pas encore. Les ventes magasin (`sales`) portent l'EAN tel que le PIM le publie.

Une commande OMS génère un mouvement WMS par ligne (`wms_movements` : sortie si expédiée, réservation sinon) et une livraison TMS par commande (`tms_deliveries`).

`scripts/test-coherence.mjs` vérifie l'intégrité référentielle entre toutes les applications, hors erreurs volontaires : exhaustivement en taille démo, par échantillon de 3 000 lignes par table en taille scale.

## Deux tailles, un seul générateur

`lib/multisource-gen.js` calcule chaque ligne à partir de son seul rang, avec une graine fixe. Le même code sert :

- à la **taille démo** (`npm run generate:demo`), écrite dans `data/multisource-demo.json`, versionnée et servie en ligne avec tous les filtres ;
- aux **API à grande échelle**, en ajoutant `size=scale` à toute ressource. Les millions de lignes sont générés à la volée, page par page (1 000 lignes au plus, mises en cache CDN un jour, 60 requêtes par minute au plus). Rien n'est stocké ni sur git ni sur Vercel. Seule la pagination est offerte ; `$filter`, `updatedAfter` et `aggregate` renvoient 400 ;
- au **Parquet** (`npm run generate:scale`), qui écrit dans `/tmp/maison-lucie-scale` (230 s, 520 Mo). Le lac y est partitionné par mois.

La génération Parquet utilise, pour les six premières applications, la même logique écrite en SQL DuckDB ; APS, SRM et QMS sont écrits depuis le générateur JavaScript (`scripts/multisource-sql.mjs`, hachage `h32` identique). `scripts/test-generator-equivalence.mjs` vérifie que JavaScript et SQL donnent exactement les mêmes lignes, table par table.

| Table | Démo | Scale |
|---|---|---|
| sap_suppliers | 63 | 5 025 |
| sap_purchase_orders | 800 | 1 000 000 |
| pim_products | 1 200 | 1 000 000 |
| wms_facilities | 12 | 500 |
| wms_stock | 3 600 | 5 000 000 |
| tms_shipments | 800 | 1 000 000 |
| aps_forecasts | 3 600 | 1 200 000 |
| srm_suppliers | 60 | 5 000 |
| qms_nonconformities | 400 | 200 000 |
| wms_movements | 3 000 | 10 000 000 |
| tms_deliveries | 1 001 | 3 333 334 |
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
| Raison sociale variante (`TESSITURA MILANO Ltd`) | TMS | 8 | 4 368 | ressemblance en file de validation, jamais appliquée seule |
| Référence en minuscules | OMS | 60 | 200 000 | normaliser |
| Code magasin `btq_par_fsh` | lac | — | — | normaliser |
| Pays fournisseur différent de SAP | PIM | 3 | 218 | écart de fond, signalé dans la preuve des alertes |
| Prévision sur une référence inconnue (`ML-9…`) | APS | 7 | 1 200 | orphelin |
| Certification expirée | SRM | 5 | 454 | à signaler dans le risque fournisseur |
| TVA « FR-12-… », nom « (groupe) » | SRM | — | — | normaliser, rapprocher |
| Non-conformité sur un EAN inconnu | QMS | 4 | 2 061 | orphelin |
| Commande `PO-4500000001` (TMS) contre `4500000001` (SAP) | TMS | — | — | normaliser |

## Récit de démonstration

Le récit reprend les 15 fournisseurs et les 20 articles des alertes existantes (`SUP-001` Tessitura Milano, `CLASP-AURORA`…). Tessitura Milano et Shenzhen Atelier Components ont un taux de retard élevé, et des articles du récit sont en rupture sur un site. Les alertes existantes (`ALT-*`, jeux `lib/demo-data.js`) sont inchangées et restent reproductibles.

## Canaux d'échange : protocoles réalistes par application, et MCP

Chaque application ne répond que sur les canaux que **ce type d'outil expose réellement sur le marché**. Un autre canal renvoie `404 CHANNEL_NOT_OFFERED`, avec la liste des canaux disponibles (gRPC : `grpc-status: 12` ; GraphQL : champ racine absent du schéma ; SOAP : faute `Client`). La matrice est dans `lib/channels.js` (`PROTOCOLS`) et publiée par l'index `GET /channels` (`sources[].channels`, `sources[].nativeChannel`). Une seule lecture canonique (`readRows`) alimente tous les canaux : **les lignes lues sont identiques sur chaque canal autorisé**, seuls l'enveloppe et le transport changent. `scripts/test-channels.mjs` le vérifie pour les 41 ressources, et vérifie le refus des canaux non autorisés. Tout est simulé, déterministe et en lecture seule : aucun broker, aucun appel sortant.

L'ESB et MCP sont des **passerelles transverses** : ouverts pour toutes les applications (ils se branchent devant les API des outils). REST reste ouvert pour toutes les applications sauf SAP (dont l'accès « REST » est OData v2).

L'index public des canaux est servi par `GET /channels`. Tous les autres points d'accès demandent le jeton passerelle (`Authorization: Bearer lucie_aura_gateway_demo_token`) ; RabbitMQ, IBM MQ et RFC acceptent aussi `Basic <utilisateur>:<jeton>`.

### Protocoles par type d'outil (natif en premier)

| Application | Type d'outil (éditeurs types) | Canaux offerts | Source publique | À confirmer |
|---|---|---|---|---|
| sap | ERP (SAP S/4HANA) | OData v2, OData v4, RFC/BAPI, IDoc, SOAP, EDIFACT, X12, AS2 | [SAP S/4HANA : REST et SOAP](https://radar.apideck.com/blog/guide-to-sap-4-hana-rest-and-soap-api), [API au lieu d'IDoc pour l'EDI (Seeburger)](https://blog.seeburger.com/edi-connection-sap-s4hana-with-apis-instead-of-idocs/) | l'EDI passe par le traducteur EDI du client |
| pim | PIM (Akeneo, Salsify) | REST, fichiers SFTP | [API REST Akeneo](https://api.akeneo.com/documentation/why-the-api.html), [connecteur SFTP Akeneo](https://wearepatchworks.com/products/akeneo-sftp-connector-integration) | Salsify : à confirmer |
| manhattan | WMS (Manhattan Active WM, Reflex, SAP EWM) | REST, SOAP, fichiers SFTP, IBM MQ, AMQP | [Manhattan Active : API REST](https://docs.nexla.com/user-guides/connectors/manhattan_api/overview) | SOAP, fichiers et files de messages selon l'éditeur et l'intergiciel du client ; IDoc seulement pour SAP EWM (non simulé ici) |
| tms | TMS (Blue Yonder, SAP TM) | REST, EDIFACT, X12, AS2, fichiers SFTP, IBM MQ, AMQP | [Blue Yonder TMS : EDI X12/EDIFACT par AS2, SFTP et API](https://www.stacksync.com/edi/dsv/dsv-via-blue-yonder) | files de messages selon l'intergiciel ; **pas d'IDoc** (DESADV01 refusé) |
| aps | APS (Kinaxis, o9) | REST, fichiers SFTP | [Kinaxis : API, services web et fichiers](https://www.makini.io/integrations/kinaxis-rapidresponse) | o9 : à confirmer |
| srm | SRM (Coupa, SAP Ariba) | REST, SOAP, fichiers SFTP | [Coupa : API REST et fichiers CSV](https://compass.coupa.com/en-us/products/core-platform/integration-playbooks-and-resources/other-integration-playbooks/invoicing-platform-integration/build-your-integration/using-the-api), [Ariba : services web SOAP](https://www.cleverence.com/amp/articles/sap-documentation/web-services-overview-sap-ariba-4827/) | cXML n'est pas simulé |
| qms | QMS (ETQ, SAP QM, MasterControl) | REST, SOAP | — | à confirmer selon l'éditeur |
| oms | OMS / e-commerce (Salesforce Commerce, Shopify) | REST, GraphQL, webhooks (CloudEvents), Salesforce REST/Bulk, gRPC-web | [Shopify : API GraphQL Admin et webhooks](https://shopify.dev/docs/api/admin-graphql/latest/objects/WebhookSubscription) | gRPC : l'API Pub/Sub de Salesforce est en gRPC, à confirmer pour le périmètre OMS ; Shopify n'en a pas |
| hr | SIRH (Workday, SAP SuccessFactors) | SOAP, REST, OData v4, fichiers SFTP | [Workday : API SOAP](https://community-content.workday.com/en-us/public/products/platform-and-product-extensions/soap-api-reference.html), [SuccessFactors : OData v2 et v4](https://www.cdata.com/drivers/sapsuccessfactors/odata/) | fichiers (Workday EIB) à confirmer |
| lake | Lac de données (Snowflake, Databricks) | SQL/JDBC, REST, fichiers SFTP (Parquet), Kafka, CDC | [Snowflake : connecteur Kafka et JDBC](https://docs.snowflake.com/en/user-guide/kafka-connector) | — |
| toutes | passerelles | ESB, MCP | — | — |

Documents dérivés : un document EDI ou IDoc n'est servi que si l'application d'origine expose ce canal (ORDERS/INVOIC et 850/810 viennent de SAP ; DESADV et 856 du TMS ; IDoc ORDERS05 et CREMAS05 de SAP ; DESADV01 (TMS) et MATMAS05 (PIM) sont refusés).

### Points d'accès par canal

| Canal | Point d'accès |
|---|---|
| REST | `/api/sources/{source}?resource=` |
| OData v2 (SAP) | `/sap/opu/odata/sap/…` |
| OData v4 | `/odata/v4/{source}/{EntitySet}`, `$metadata` |
| GraphQL | `/api/graphql` (champ `srcOms`) |
| SOAP 1.1 | `/api/soap?source=` (`GetRecords`, WSDL typé) |
| SAP IDoc XML | `/sap/idoc/{ORDERS05, CREMAS05}` |
| SAP RFC / BAPI (JSON-RPC) | `POST /sap/bc/rfc` |
| Salesforce REST (SOQL) et Bulk API 2.0 | `/services/data/v60.0/query`, `/jobs/query` |
| Kafka (HTTP) | `/api/kafka?topic=lucie.{source}.{resource}` |
| AMQP · RabbitMQ | `POST /api/queues/%2F/{file}/get` |
| IBM MQ | `/ibmmq/rest/v2/messaging/qmgr/LUCIEQM/queue/{FILE}/message` |
| CloudEvents / webhooks | `/cloudevents/{source}/{resource}` |
| CDC (Debezium) | `/cdc/{source}/{resource}` |
| EDIFACT D.96A | `/edi/edifact/{ORDERS, INVOIC, DESADV}` |
| ANSI X12 004010 | `/edi/x12/{850, 810, 856}` |
| AS2 | `/as2/outbox`, `/as2/message/{id}`, `POST /as2` |
| Fichiers CSV, JSON, XML, Parquet (SFTP) | `/sftp/ls`, `/sftp/get?path=/outbound/…` |
| SQL / JDBC (lecture seule, lac) | `POST /sql` |
| Agrégat poussé à la source (lac) | `?aggregate=1&groupBy=` |
| gRPC-web | `POST /grpc/lucie.v1.RowService/ListRows` |
| ESB / iPaaS (demi-flux) | `/esb/api/v1/{flux}` |
| MCP | `POST /mcp` |

Les canaux historiques des 10 applications de `lib/demo-data.js` (`/api/data/{app}`) sont inchangés.

### Ce qui est simulé

| Canal | Ce qui est réel | Ce qui est simulé ou simplifié |
|---|---|---|
| OData v4 | Forme de réponse (`@odata.context`, `value`, `@odata.count`, `@odata.nextLink`), CSDL 4.0 | `$filter` limité à `eq ne gt ge lt le and` ; pas de `$expand` ni de `$apply` |
| GraphQL | Introspection, SDL, arguments `limit`/`offset` et filtres d'égalité | Lecture seule ; `limit` ≤ 1 000 |
| SOAP | Enveloppe SOAP 1.1, WSDL document/literal, types `xsi:type` | Une seule opération `GetRecords` par source |
| IDoc | Types et segments réels (EDI_DC40, E1EDK01, E1EDKA1, E1EDK02, E1EDP01/E1EDP20/E1EDP19 ; E1EDL20/E1ADRM1/E1EDT13/E1EDL24/E1EDL41 ; E1LFA1M/E1LFB1M ; E1MARAM/E1MAKTM) | Représentation XML seulement (pas de format plat ni de port tRFC) ; segments obligatoires minimaux ; `E1EDT13-QUALF 007` et `E1EDL20-TRATY` portent la date prévue et le mode de transport (à confirmer avec le client) ; `KRAUS` porte le DUNS ; l'horodatage de modification SAP n'a pas de segment |
| RFC / BAPI | Noms et paramètres réels (`RFC_READ_TABLE` : QUERY_TABLE, DELIMITER, FIELDS, OPTIONS, ROWCOUNT, ROWSKIPS, FIELDS/DATA-WA ; `BAPI_PO_GETDETAIL1` : POHEADER/POITEM/POSCHEDULE/RETURN ; `BAPI_VENDOR_GETDETAIL`) | Transport JSON-RPC 2.0 sur HTTP à la place du protocole RFC (SDK NW RFC ou JCo) ; `RFC_READ_TABLE` lit LFA1/EKPO avec les noms de champs des API OData, pas les noms techniques (LIFNR, NAME1…) |
| Salesforce | Forme `query` (`totalSize`, `done`, `nextRecordsUrl`, `attributes`), `sobjects`, `describe`, Bulk API 2.0 (job, `JobComplete`, CSV, `Sforce-Locator`), jeton OAuth client credentials | Objets `Lucie_<Source>_<Ressource>__c` ; les champs gardent le nom de la source (un vrai org suffixerait `__c`) ; SOQL limité au sous-ensemble SQL ci-dessous ; `Id` dérivé de la clé |
| Kafka | Topics, offsets, clé, CloudEvents 1.0 en valeur | Pont HTTP, sans broker ni groupe de consommateurs |
| AMQP · RabbitMQ | Forme exacte de l'API HTTP de management (`POST /api/queues/{vhost}/{queue}/get`, `payload`, `properties`, `message_count`) | Sans état : la file n'est jamais vidée, le client porte `offset` ; pas de connexion AMQP 0-9-1 (Vercel n'héberge pas de broker) ; `wait` (long-polling) plafonné à 1 s |
| IBM MQ | Chemin et en-têtes de l'API REST messaging v2 (`ibm-mq-md-messageId`…), 204 quand la file est vide | Lecture non destructive (browse) par `offset` ; pas de GET destructif (DELETE) |
| CloudEvents / webhooks | CloudEvents 1.0, lot `application/cloudevents-batch+json`, lien `rel="next"` | Les livraisons sortantes (webhooks poussés) ne sont pas émises : Aura tire le lot (aucun appel sortant depuis Vercel) |
| CDC | Enveloppe Debezium (`before`, `after`, `source`, `op`, `ts_ms`), instantané `r` puis `c` et `u` | Coupure fixe (2026-09-27 12:00) : les lignes modifiées après sont émises en `c`, et une sur trois en `c` puis `u` avec un état antérieur reconstitué ; le rejeu redonne exactement la table |
| EDIFACT | Syntaxe ISO 9735 (UNA, UNB/UNZ, UNH/UNT, caractère de libération `?`), répertoire D.96A, qualifiants réels (BGM 220/351/380, DTM 137/2/132/35, QTY 21/12/47, NAD BY/SU/ST, MOA 203/86, PRI AAA, TDT 20 + code mode Rec. 19) | Une ligne de commande par message ; codes partenaires `ZZZ`/`92` au lieu de GLN ; INVOIC dérivé : prix = `listPrice` du PIM pour la référence commandée |
| X12 | ISA de 106 caractères, GS/ST/SE/GE/IEA, segments réels (BEG, CUR, N1, PO1, DTM 002/017/050, BSN, HL S/O/I, TD5, PRF, LIN UK, SN1, BIG, IT1, TDS, CTT) | Qualifiants `ZZ` ; 810 dérivé comme INVOIC |
| AS2 | En-têtes RFC 4130 (`AS2-From`, `AS2-To`, `Message-ID`, `Disposition-Notification-*`), MIC SHA-256, MDN `multipart/report` synchrone | Pas de signature ni de chiffrement S/MIME ; le MIC est aussi publié en en-tête `X-Lucie-Content-MIC` |
| Fichiers (SFTP) | Arborescence `/outbound/<source>`, listing façon `ls -l`, CSV, JSON, XML typé, Parquet (zstd) | Pas de protocole SSH : listing et téléchargement en HTTP ; les Parquet sont des fichiers statiques pré-générés (`npm run generate:parquet`), servis par le CDN |
| SQL / JDBC | Types de colonnes (`BIGINT`, `DOUBLE`, `BOOLEAN`, `VARCHAR`), `?tables` pour le catalogue | Sous-ensemble : `SELECT` de colonnes, `*` ou agrégats (`COUNT`, `SUM`, `MIN`, `MAX`, `AVG`) `FROM lake.<table>`, avec `WHERE … AND …`, `GROUP BY`, `ORDER BY` sur une colonne, `LIMIT`, `OFFSET`, conditions `= <> < <= > >= LIKE IN IS [NOT] NULL` ; ni jointure, ni `OR`, ni sous-requête ; lecture seule |
| gRPC-web | Cadrage gRPC-web (préfixe de 5 octets, trame de fin `grpc-status`), protobuf proto3, `.proto` publié (`GET /grpc/lucie.v1.RowService/ListRows`) | Encodage protobuf écrit à la main ; valeurs transportées en texte (`map<string,string>`) avec les types en colonnes |
| ESB / iPaaS | Couches experience → process → system (style MuleSoft), `X-Correlation-ID`, trace de route | Le « demi-flux » : l'ESB route et enveloppe, sans orchestration ni mapping métier |
| MCP | Spécification 2025-06-18 (et 2025-03-26, 2024-11-05), JSON-RPC 2.0, transport Streamable HTTP, `Origin` validé | Sans état ni session ; pas de flux SSE (GET → 405, prévu par la spécification) ; implémenté sans `@modelcontextprotocol/sdk` pour éviter toute dépendance et tout état dans la fonction |

### Serveur MCP

- URL : `https://maison-lucie-si.vercel.app/mcp` (transport Streamable HTTP, `POST` JSON-RPC 2.0).
- Authentification : `Authorization: Bearer lucie_aura_gateway_demo_token`.
- Outils : `list_sources`, `read_object`, `query` (filtres `eq ne gt ge lt le in like null notnull`, projection, tri, 1 000 lignes au plus), `kpi_series` (`sales-by-month`, `late-shipments-by-week`, `stockouts-by-site`, `nonconformities-by-severity`, `forecast-by-week`), `alerts`.
- Ressources : `lucie://catalog`, `lucie://ontology`, `lucie://schema/{source}` (JSON Schema).

Exemple de configuration client (Claude Desktop, Claude Code, Cursor…) :

```json
{
  "mcpServers": {
    "maison-lucie": {
      "type": "http",
      "url": "https://maison-lucie-si.vercel.app/mcp",
      "headers": { "Authorization": "Bearer lucie_aura_gateway_demo_token" }
    }
  }
}
```

En ligne de commande : `claude mcp add --transport http maison-lucie https://maison-lucie-si.vercel.app/mcp --header "Authorization: Bearer lucie_aura_gateway_demo_token"`.

### Budget Vercel

- Une seule fonction pour tous les nouveaux canaux et le serveur MCP (`api/hub.js`, MCP dans `lib/mcp-http.js`) ; les URL « produit » sont des réécritures `vercel.json`.
- Pages de 1 000 lignes au plus, sur tous les canaux.
- Lectures mises en cache par le CDN (`s-maxage=3600, stale-while-revalidate=86400`) ; le Parquet est statique.
- Plafond de 120 requêtes par minute et par client ; au-delà, 429 et `Retry-After: 60`.
- Aucun traitement lourd : filtre, projection et agrégat en un passage sur la taille démo ; le long-polling est plafonné à 1 s.

### Essai en local

```bash
npm run serve:vercel      # routage Vercel reproduit, http://127.0.0.1:4300
npm run test:channels     # 95 tests : chaque canal autorisé redonne les mêmes lignes que REST, les autres sont refusés
```

## Champs standard ajoutés (tous les cas d'Aura)

**Valeurs de planification fournies par le SI (30 septembre 2026).** Aura ne calcule rien : il lit. Maison Lucie sert donc, comme le ferait un APS, les valeurs que les règles d'Aura comparent à des seuils :
- `aps?resource=supply-positions` : par article et par site, `CoverageDays`, `TimeToSurviveDays` (TTS), `TimeToRecoverDays` (TTR), `RevenueAtRiskEur` (CA à risque), `ProjectedStockoutDate`, `NextReceiptDate` (équivalents : SAP IBP, MD04, Kinaxis, o9) ;
- `aps?resource=lead-time-review` : `PlannedLeadTimeDays` (MARC-PLIFZ) et `ActualLeadTimeMedianDays` (évaluation fournisseur) ;
- `aps?resource=atp-checks` : `PromisedDate` et `ConfirmedAvailabilityDate` des lignes clients ouvertes (contrôle ATP) ;
- `aps?resource=demand-signals` : `BullwhipRatio` et `DemandPeakPct` par article (outil de planification) ;
- `qms?resource=supplier-quality` : `RejectedLotsPct` par fournisseur (outil qualité) ;
- `tms?resource=shipment-emissions` : `Co2eKg` par expédition (ISO 14083, GLEC) ;
- SAP `API_PURCHASEORDER_PROCESS_SRV/A_PurOrdSupplierConfirmation` : `RequestedDeliveryDate` (EKET) et `ConfirmedDeliveryDate` (EKES, vide si non confirmée).

Pour couvrir la résilience (TTS/TTR), la crise sanitaire, les détroits, la qualité, le risque, la certification, les rappels et le devoir de vigilance, 27 ressources ont été ajoutées. Elles reprennent des objets et des champs **standard** des applications du marché, sous leur nom d'API. Elles sont calculées de façon déterministe à partir des tables existantes (mêmes identifiants), en taille démo seulement (`size=scale` renvoie `400 DEMO_SIZE_ONLY`), et sont servies par tous les canaux (`lib/si-extensions.js`, `scripts/test-extensions.mjs`).

| Ressource (API) | Équivalent réel | Champs et table ou objet d'origine |
|---|---|---|
| SAP `A_PurchasingSource` (API_PURCHASING_SOURCE_SRV) | liste de sources, table **EORD** | Material (MATNR), Plant (WERKS), SourceListRecord (ZEORD), Supplier (LIFNR), ValidityStartDate/EndDate (VDATU/BDATU), PurchasingOrganization (EKORG), SupplierIsFixed (FLIFN), SourceOfSupplyIsBlocked (NOTKZ), MRPSourcingControl (AUTET) |
| SAP `A_PurgInfoRecdOrgPlantData` (API_INFORECORD_PROCESS_SRV) | fiche info-achat, tables **EINA** + **EINE** | PurchasingInfoRecord (INFNR), Supplier et Material (EINA-LIFNR, EINA-MATNR, joints depuis l'en-tête `A_PurchasingInfoRecord` : simplification documentée), PurchasingOrganization, Plant, MaterialPlannedDeliveryDurn (EINE-APLFZ), NetPriceAmount (EINE-NETPR), Currency (EINE-WAERS), MaterialPriceUnitQty (EINE-PEINH), MinimumPurchaseOrderQuantity (EINE-MINBM) |
| SAP `A_ProductSupplyPlanning` (API_PRODUCT_SRV) | données MRP article-division, table **MARC** | Product, Plant, ProcurementType (BESKZ), MRPType (DISMM), PlannedDeliveryDurationInDays (**PLIFZ**), GoodsReceiptDuration (WEBAZ), SafetyStockQuantity (EISBE) |
| SAP `A_ProductValuation` (API_PRODUCT_SRV) | valorisation, table **MBEW** | Product, ValuationArea (BWKEY), InventoryValuationProcedure (VPRSV = S), StandardPrice (STPRS), PriceUnitQty (PEINH), MovingAveragePrice (VERPR), Currency |
| SAP `A_SlsPrcgConditionRecord` (API_SLSPRICINGCONDITIONRECORD_SRV) | condition de prix de vente **PPR0**, tables KONP + A004 | ConditionRecord (KNUMH), ConditionType (KSCHL), Material, SalesOrganization, DistributionChannel (clé A004, portée par `A_SlsPrcgCndnRecdValidity` dans l'API réelle : simplification documentée), ConditionRateValue (KBETR), ConditionRateValueUnit, ConditionQuantity (KPEIN), ConditionValidityStartDate/EndDate |
| SAP `A_PurchaseOrder` (API_PURCHASEORDER_PROCESS_SRV) | en-tête de commande, table **EKKO** | PurchaseOrder (EBELN), PurchaseOrderType (BSART), Supplier (LIFNR), PurchasingOrganization, PurchasingGroup, PurchaseOrderDate (BEDAT), DocumentCurrency |
| SAP `A_MaterialDocumentItem` (API_MATERIAL_DOCUMENT_SRV) | entrée de marchandises, table **MSEG** (mouvement 101) | MaterialDocument (MBLNR), MaterialDocumentYear, MaterialDocumentItem, Material, Plant, GoodsMovementType (BWART), PurchaseOrder, PurchaseOrderItem, Supplier, Batch (**CHARG**), PostingDate (BUDAT), QuantityInEntryUnit |
| OMS `order-history` | lignes de commande livrées (Salesforce Order Management `OrderItemSummary`, SAP S/4 `A_SalesOrderItem`) | mêmes champs que `order-lines` ; 52 semaines, pic de 2026-W11 à 2026-W16 |
| Lac `demand-history`, `purchase-history` | tables d'historique hebdomadaire du lac (copies J-1 agrégées de l'OMS et de l'ERP) | Week, ProductRef ou Material, Quantity ou OrderedQty, `_source`, `_ingestedAt` |
| RH `emp-job`, `employee-time` | **SAP SuccessFactors Employee Central** : `EmpJob`, `EmployeeTime` (Time Off) ; Workday : Worker, Time Off | userId, startDate, seqNumber, company, location, department, jobCode, emplStatus ; externalCode, userId, timeType, startDate, endDate, quantityInDays, approvalStatus |
| Lac `absenteeism` | indicateur WFM calculé dans le lac (UKG, Workday Absence) | Week, Site, Headcount, PlannedDays, AbsenceDays, AbsenteeismRate = AbsenceDays / PlannedDays |
| TMS `routes` | ligne ou horaire maritime (SAP TM *transportation lane* et *schedule*, Blue Yonder TMS *lane*) | RouteId, OriginPort, DestinationPort, TransitPorts (escales en **UN/LOCODE**), TransitDays, Carrier, TransportMode, ValidFrom, ValidTo |
| TMS `shipment-stages` | étapes d'un ordre de fret (SAP TM *freight order stages*, Blue Yonder *stops*) | ShipmentId, StageSequence, StageType, RouteId, SourceLocation, DestinationLocation (UN/LOCODE), PlannedDeparture, PlannedArrival, ActualArrival |
| TMS `events` | évènements de suivi (SAP Event Management, project44 / FourKites) | EventId, EventCode (CONGESTION, BLOCKED, DIVERSION, STRIKE), Location (UN/LOCODE), RouteId, ShipmentId, StartDate, EndDate, EstimatedDelayDays, Reason |
| SRM `certificates` | certificats fournisseur (SAP Ariba SLM, Coupa Supplier Information) | CertificateId, SrmId, ErpVendorId (identifiant fournisseur ERP), CertificateType, CertificateNumber, IssuedBy, ValidFrom, ValidTo, Status |
| SRM `risk-assessments` | évaluations de risque (SAP Ariba Supplier Risk, Coupa Risk Assess) | AssessmentId, SrmId, ErpVendorId, RiskCategory (OVERALL, FINANCIAL, OPERATIONAL, SUPPLY_CAPACITY, GEOPOLITICAL, ESG), Score, RiskLevel, AssessedOn ; historique mensuel du risque financier ; trois fournisseurs sans évaluation ESG |
| WMS `outbound-deliveries` | lignes expédiées avec lot (Manhattan Active WM : *shipped order line* / LPN ; SAP EWM : poste de livraison sortante avec lot) | DeliveryId, OrderId, OrderLineId (commande OMS), ItemId (GTIN-14), BatchNumber, ShippedQuantity, FacilityId, ShippedAt ; le lot suit le FIFO des réceptions |
| QMS `inspection-lots` | lot de contrôle à la réception (SAP QM, table **QALS** et décision d'emploi **QAVE**, API_INSPECTIONLOT_SRV) | InspectionLot (PRUEFLOS), InspectionLotOrigin (HERKUNFT 01), Material, Batch (CHARG), Plant, Supplier, PurchaseOrder, InspectionLotQuantity, InspectionLotDefectiveQuantity, InspectionLotUsageDecisionCode (A accepté, R refusé), InspectionLotEndDate |

Les détroits ne sont pas un champ : ils se lisent dans les escales (EGSUZ, EGPSD pour le canal de Suez ; ZACPT pour le cap de Bonne-Espérance ; SGSIN pour Malacca).

### Scénarios illustratifs (cas réglés à la main)

Trois cas sont **calibrés à la main** pour que les alertes d'Aura se déclenchent sur la démo. Ils ne reflètent pas une distribution observée. Chaque ligne concernée porte le champ `_scenario: "illustratif"` (les autres lignes de ces tables portent `_scenario: null`), sur tous les canaux ; `scripts/test-alert-cases.mjs` vérifie que seules ces lignes sont marquées.

| Cas | Ce qui a été calibré | Lignes marquées |
|---|---|---|
| Fournisseur unique (TTR > TTS) | les 6 articles stockés dont l'écart couverture − (délai + 60 j) est le plus faible n'ont qu'une source approuvée, et le délai planifié de leur source fixe est allongé de l'écart + 10 j | `A_PurchasingSource` (6), `A_PurgInfoRecdOrgPlantData` (6), `A_ProductSupplyPlanning` (6) |
| Port congestionné | un évènement `CONGESTION` de 4 jours est placé sur le port d'arrivée (Le Havre, FRLEH) de l'expédition maritime ouverte la moins couverte | `events` (1) |
| Dérive de délai fournisseur | les réceptions des 4 dernières semaines de 0000100003 et 0000100006 arrivent 35 à 50 % plus tard que le délai planifié | `A_MaterialDocumentItem` (réceptions concernées) |

Dans Aura Supply, l'alerte qui en découle porte un badge discret « scénario illustratif », dont l'infobulle dit ce qui a été calibré. Le badge n'apparaît que sur des données Maison Lucie.

D'autres éléments du récit sont aussi posés à la main, sans champ dédié : la hausse du risque financier de SRM-00003 et SRM-00012 (+25 points en 5 mois) et l'absence d'évaluation ESG de SRM-00007, SRM-00015 et SRM-00022.

Les paramètres par défaut d'Aura restent affichés comme **hypothèses à confirmer** avec le client : 60 jours de requalification d'une nouvelle source, 25 % par an de portage du stock, 90 jours de couverture cible, 40 € par client de coût de reprise d'un rappel.

### Cas reproductibles des alertes d'Aura

`scripts/test-alert-cases.mjs` recalcule chaque règle sur ces tables, indépendamment d'Aura, et vérifie qu'elle se déclenche (11 alertes).

| Alerte Aura | Cas dans Maison Lucie |
|---|---|
| Fournisseur unique (TTR > TTS) | 6 articles stockés n'ont qu'une source approuvée (EORD) et un délai planifié (EINE-APLFZ) qui, avec 60 jours de requalification, dépasse leur couverture ; ex. ML-0000081 : TTS 73 j, TTR 83 j |
| Exposition géographique | 27 % de la valeur des commandes ouvertes vient d'Asie ou passe par Suez (seuil 20 %) |
| Stock de sécurité sous-dimensionné | MARC-EISBE couvre 10 à 25 jours de demande prévue, moins que le TTR |

Le TTS est celui d'Aura : (stock disponible + en transit) / demande journalière prévue (APS, première semaine).
| Dérive des délais fournisseur | 0000100003 et 0000100006 livrent 35 à 50 % plus tard que le délai planifié depuis 4 semaines |
| Effet coup de fouet | variance des commandes (lac, ERP) supérieure à 1,5 fois celle de la demande (lac, OMS) |
| Défaillance financière | SRM-00003 et SRM-00012 : risque financier en hausse de 25 points en 5 mois |
| Qualité ou certification | lots refusés (QMS) d'au moins 10 % ; certificats échus ou échéant sous 60 jours (SRM) |
| Congestion portuaire ou grève | congestion en cours au Havre (FRLEH, 4 jours d'attente) pour une expédition dont l'article couvre 78 jours hors transit (la marchandise bloquée n'est pas comptée) |
| BFR : stock immobilisé | articles à plus de 90 jours de couverture, valorisés au coût standard (MBEW) |
| Rappel produit | 7 lots refusés au contrôle (QMS) déjà expédiés (WMS) à des clients (OMS) |
| Devoir de vigilance (ESG) | SRM-00007, SRM-00015 et SRM-00022 sans évaluation ESG ; scores ESG élevés ; certificats ISO 14001 ou SA8000 échus |

## Tests

```bash
npm run test:multisource   # contrats OData/REST/lac, erreurs volontaires, taille scale à la volée, $metadata, équivalence JS/SQL
npm run test:channels      # canaux autorisés : mêmes lignes ; canaux non autorisés : refus 404
node scripts/test-extensions.mjs   # champs standard ajoutés : cohérence avec les tables existantes
node scripts/test-alert-cases.mjs  # un cas reproductible par alerte de résilience d'Aura
npm test                   # tous les tests (le smoke test demande le serveur local : npm start)
```
