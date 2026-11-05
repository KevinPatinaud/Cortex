# Supervision et réparation de l’infrastructure Lunaria

Un seul agent Cortex, exécuté tous les jours à **9 h 30**, plus les **mardis,
mercredis et jeudis à 3 h 15**, dans **Europe/Paris**. Une sonde systemd passive
indépendante de Cortex observe les services toutes les cinq minutes, sans modèle,
sans envoi externe et sans réparation automatique entre les passages.

## Composants

- `infra_health.py` : mesures réelles, état agrégé privé, diagnostics de base et
  actions explicitement délimitées. Installé root-owned sous `/usr/local/lib/lunaria-infra`.
- `infra_maintenance.py` : inventaire, mises à jour examinées de Node/tzdata,
  activation différée du runtime et validation persistante après démarrage.
- `install_system.py` : installe le helper et la sonde avec les droits sudo déjà
  disponibles ; n’ajoute aucune règle sudo ni permission administrative générale.
- `infra_agent.py` : lecture de l’état et préflight sans condition de santé du site.
- `agent-prompt.md` : mission et interventions autorisées, preuves, limites et reprise.
- `install.py` : création via l’API Cortex, profil et deux créneaux ; conserve les
  consignes, horaires, profils, verrous et quotas des autres projets.

## Installation sur le serveur

```sh
cd /home/kevin/Cortex/cortex/ops/lunaria-infra
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest -v test_infra_health.py test_infra_maintenance.py
sudo -n python3 install_system.py
python3 install.py
```

Le projet est son propre espace de travail. Il n’utilise pas le dépôt applicatif
ni ses préconditions Git/santé qui bloqueraient un réparateur pendant une panne.
Les réparations prennent le verrou du helper et celui des déploiements Lunaria.
Le helper limite les tentatives identiques et refuse d’interrompre un service en
transition ou le Cortex actif qui exécute l’agent.

L’API d’authentification réutilise l’utilitaire déjà installé dans les ops des
personnages ; aucun identifiant n’est affiché ni ajouté à Git. Les fichiers root,
unités et anciens paramètres sont préservés ou sauvegardés lors des mises à jour.

## Contrôles et réparations

```sh
sudo -n /usr/local/sbin/lunaria-infra collect
sudo -n /usr/local/sbin/lunaria-infra repair-service nginx.service
sudo -n /usr/local/sbin/lunaria-infra backup site
sudo -n /usr/local/sbin/lunaria-infra verify-backup site
sudo -n /usr/local/sbin/lunaria-infra verify-backup mail
```

La sonde contrôle les unités permanentes et timers, HTTP/HTTPS, requête PostgreSQL,
ports mail, file agrégée, disque/inodes, mémoire disponible, charge et sauvegardes.
Les certificats sont contrôlés depuis les connexions TLS réellement servies.
Un oneshot inactif après succès est traité comme une tâche terminée, pas une panne.
Les courriels et informations d’abonnés ne sont pas lus ou envoyés pour tester.

Les sauvegardes sont vérifiées depuis les archives réelles : gzip, structure,
empreinte mail, restauration du dump dans une base temporaire strictement nommée,
tables applicatives et comptes agrégés. Seule cette base temporaire est supprimée.
Les données actives et les boîtes ne sont jamais restaurées ou remplacées.
L’archive mail est contrôlée, mais aucun import Dovecot complet n’est revendiqué.

Les états sont sous `/var/lib/lunaria-infra`, lisibles par le compte de l’agent,
modifiables seulement via l’installation root et les outils privilégiés. Le compte
serveur possédait déjà des droits sudo étendus : le helper fournit une voie normale
bornée, il ne prétend pas retirer ou cloisonner ces droits préexistants.

Les redémarrages globaux, migrations majeures, changements d’accès réseau et
restaurations de données actives demandent une opération de maintenance distincte.
Une panne complète du VPS nécessite une sonde externe ; aucune surveillance hors
du VPS n’est installée ici. Cortex arrêté ne peut pas exécuter cet agent, alors que
la sonde systemd indépendante continue à enregistrer ce qu’elle peut observer.

## Maintenance examinée et reprise

`sudo -n /usr/local/sbin/lunaria-infra inventory` relève les versions réellement
installées, le noyau actif, l’état dpkg et l’utilisation du binaire Node installé.
Les candidats APT reflètent le cache local, sans affirmer sa fraîcheur ni déduire
une vulnérabilité du seul numéro de version.

`upgrade-packages PACKAGE=VERSION ...` accepte seulement Node et tzdata avec des
versions exactes examinées correspondant aux candidats APT. Une montée majeure
Node, un paquet retenu, un retrait ou une dépendance supplémentaire annulent
l’opération. Les sauvegardes récentes sont restaurées en isolation et les anciens
paquets doivent être téléchargés avec leurs empreintes avant toute installation.
`package-maintenance.json` conserve la transaction et son répertoire de retour
arrière privé. Un échec exige une réconciliation, sans restauration automatique.

`plan-runtime-restart` prépare une activation indépendante de Cortex entre
04 h 40 et 05 h 30 Europe/Paris. Le timer dédié reste désactivé sans plan explicite
et après un résultat terminal. Avant un restart, le helper vérifie à nouveau la
file Cortex, ses processus, les sauvegardes et la santé des services. Il prend
les verrous de maintenance, de déploiement et de mise à jour Cortex. Un plan
interrompu n’est jamais rejoué aveuglément ; consulter `runtime-restart.json`.

`lunaria-infra-boot.timer` lance `validate-boot` trois minutes après chaque
démarrage, sans réparer ni provoquer de reboot. Le résultat et le noyau actif
restent dans `boot-validation.json`. Un reboot nécessaire reste une intervention
distincte avec récupération indépendante vérifiée et validation du retour.

L’option d’installation `--harden-resolver` désactive LLMNR et mDNS par un
[drop-in systemd-resolved](https://www.freedesktop.org/software/systemd/man/257/resolved.conf.html#LLMNR=).
Le service tourne sans privilèges root : le dossier et le fichier doivent être
lisibles par ce compte. L’installateur répare un dossier restrictif uniquement
s’il est vide ou contient seulement son fichier géré. Il préserve les autres
configurations privées, sauvegarde contenu et permissions, vérifie le DNS avant
et après, puis l’absence de listener LLMNR. En cas d’échec, il restaure le fichier
et les permissions puis vérifie le DNS ; `rolled-back` n’est écrit qu’après cette
validation, sinon l’état reste `rollback-required`.

Les états, archives, preuves de restauration et rapports de mission restent
privés ; seuls les outils et procédures reproductibles sont inclus dans Git.
