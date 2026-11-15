"""Deterministic registry mapping Colombian departments and global AOIs to authorities."""

from brasa.alerts.schemas import AuthorityContact

NATIONAL_COLOMBIA_AUTHORITIES: tuple[AuthorityContact, ...] = (
    AuthorityContact(
        code="UNGRD",
        name=(
            "Unidad Nacional para la Gestión del Riesgo de Desastres "
            "(Sala de Crisis Nacional)"
        ),
        level="national",
        role_es=(
            "Coordinación del SNGRD, activación de salas de crisis "
            "departamentales/municipales y movilización de recursos aéreos o terrestres."
        ),
        role_en=(
            "National disaster-risk coordination (SNGRD), crisis room "
            "activation, and aerial/ground firefighting mobilization."
        ),
        portal="https://portal.gestiondelriesgo.gov.co",
    ),
    AuthorityContact(
        code="IDEAM",
        name=(
            "Instituto de Hidrología, Meteorología y Estudios Ambientales "
            "(Oficina de Pronósticos y Alertas)"
        ),
        level="national",
        role_es=(
            "Emisión de boletines oficiales de amenaza por incendios de cobertura "
            "vegetal, seguimiento meteorológico y monitoreo ENSO/ONI."
        ),
        role_en=(
            "Official national vegetation-fire hazard bulletins, meteorological "
            "forecasting, and ENSO/ONI monitoring."
        ),
        portal="https://www.pronosticosyalertas.gov.co",
    ),
    AuthorityContact(
        code="DNBC",
        name="Dirección Nacional de Bomberos de Colombia (CITEL)",
        level="national",
        role_es=(
            "Despacho y coordinación operativa de Cuerpos de Bomberos "
            "Oficiales y Voluntarios en territorio."
        ),
        role_en="Operational dispatch and coordination of municipal and volunteer fire brigades.",
        portal="https://www.dnbc.gov.co",
    ),
)

# Statutory environmental authority (CAR / Autoridad Ambiental) for each of the 33 units.
COLOMBIA_CAR_BY_DEPARTMENT: dict[str, tuple[str, str, str | None]] = {
    "Amazonas": (
        "CORPOAMAZONIA",
        "Corporación para el Desarrollo Sostenible del Sur de la Amazonia",
        "https://www.corpoamazonia.gov.co",
    ),
    "Antioquia": (
        "CORANTIOQUIA / CORNARE / CORPOURABÁ",
        "Corporaciones Autónomas Regionales de Antioquia y Área Metropolitana del Valle de Aburrá",
        "https://www.corantioquia.gov.co",
    ),
    "Arauca": (
        "CORPORINOQUIA",
        "Corporación Autónoma Regional de la Orinoquía",
        "https://www.corporinoquia.gov.co",
    ),
    "Atlántico": (
        "CRA",
        "Corporación Autónoma Regional del Atlántico",
        "https://www.crautonoma.gov.co",
    ),
    "Bogotá, D.C.": (
        "SDA / IDIGER",
        (
            "Secretaría Distrital de Ambiente e Instituto Distrital de Gestión "
            "de Riesgos y Cambio Climático"
        ),
        "https://www.idiger.gov.co",
    ),
    "Bolívar": (
        "CARDIQUE / CSB",
        "Corporación Autónoma Regional del Canal del Dique / Sur de Bolívar",
        "https://www.cardique.gov.co",
    ),
    "Boyacá": (
        "CORPOBOYACÁ / CAR / CORPOCHIVOR",
        "Corporación Autónoma Regional de Boyacá (y jurisdicciones CAR / CORPOCHIVOR)",
        "https://www.corpoboyaca.gov.co",
    ),
    "Caldas": (
        "CORPOCALDAS",
        "Corporación Autónoma Regional de Caldas",
        "https://www.corpocaldas.gov.co",
    ),
    "Caquetá": (
        "CORPOAMAZONIA",
        "Corporación para el Desarrollo Sostenible del Sur de la Amazonia",
        "https://www.corpoamazonia.gov.co",
    ),
    "Casanare": (
        "CORPORINOQUIA",
        "Corporación Autónoma Regional de la Orinoquía",
        "https://www.corporinoquia.gov.co",
    ),
    "Cauca": (
        "CRC",
        "Corporación Autónoma Regional del Cauca",
        "https://www.crc.gov.co",
    ),
    "Cesar": (
        "CORPOCESAR",
        "Corporación Autónoma Regional del Cesar",
        "https://www.corpocesar.gov.co",
    ),
    "Chocó": (
        "CODECHOCÓ",
        "Corporación Autónoma Regional para el Desarrollo Sostenible del Chocó",
        "https://www.codechoco.gov.co",
    ),
    "Cundinamarca": (
        "CAR / CORPOGUAVIO",
        "Corporación Autónoma Regional de Cundinamarca (y CORPOGUAVIO / CORPORINOQUIA)",
        "https://www.car.gov.co",
    ),
    "Córdoba": (
        "CVS",
        "Corporación Autónoma Regional de los Valles del Sinú y del San Jorge",
        "https://www.cvs.gov.co",
    ),
    "Guainía": (
        "CDA",
        "Corporación para el Desarrollo Sostenible del Norte y el Oriente Amazónico",
        "https://www.cda.gov.co",
    ),
    "Guaviare": (
        "CDA",
        "Corporación para el Desarrollo Sostenible del Norte y el Oriente Amazónico",
        "https://www.cda.gov.co",
    ),
    "Huila": (
        "CAM",
        "Corporación Autónoma Regional del Alto Magdalena",
        "https://www.cam.gov.co",
    ),
    "La Guajira": (
        "CORPOGUAJIRA",
        "Corporación Autónoma Regional de La Guajira",
        "https://www.corpoguajira.gov.co",
    ),
    "Magdalena": (
        "CORPAMAG",
        "Corporación Autónoma Regional del Magdalena",
        "https://www.corpamag.gov.co",
    ),
    "Meta": (
        "CORMACARENA",
        "Corporación para el Desarrollo Sostenible del Área de Manejo Especial La Macarena",
        "https://www.cormacarena.gov.co",
    ),
    "Nariño": (
        "CORPONARIÑO",
        "Corporación Autónoma Regional de Nariño",
        "https://www.corponarino.gov.co",
    ),
    "Norte de Santander": (
        "CORPONOR",
        "Corporación Autónoma Regional de la Frontera Nororiental",
        "https://www.corponor.gov.co",
    ),
    "Putumayo": (
        "CORPOAMAZONIA",
        "Corporación para el Desarrollo Sostenible del Sur de la Amazonia",
        "https://www.corpoamazonia.gov.co",
    ),
    "Quindío": (
        "CRQ",
        "Corporación Autónoma Regional del Quindío",
        "https://www.crq.gov.co",
    ),
    "Risaralda": (
        "CARDER",
        "Corporación Autónoma Regional de Risaralda",
        "https://www.carder.gov.co",
    ),
    "San Andrés y Providencia": (
        "CORALINA",
        (
            "Corporación para el Desarrollo Sostenible del Archipiélago de "
            "San Andrés, Providencia y Santa Catalina"
        ),
        "https://www.coralina.gov.co",
    ),
    "Santander": (
        "CAS / CDMB",
        "Corporación Autónoma Regional de Santander / Meseta de Bucaramanga",
        "https://www.cas.gov.co",
    ),
    "Sucre": (
        "CARSUCRE / CORPOMOJANA",
        "Corporación Autónoma Regional de Sucre / Desarrollo Sostenible de La Mojana",
        "https://www.carsucre.gov.co",
    ),
    "Tolima": (
        "CORTOLIMA",
        "Corporación Autónoma Regional del Tolima",
        "https://www.cortolima.gov.co",
    ),
    "Valle del Cauca": (
        "CVC",
        "Corporación Autónoma Regional del Valle del Cauca",
        "https://www.cvc.gov.co",
    ),
    "Vaupés": (
        "CDA",
        "Corporación para el Desarrollo Sostenible del Norte y el Oriente Amazónico",
        "https://www.cda.gov.co",
    ),
    "Vichada": (
        "CORPORINOQUIA",
        "Corporación Autónoma Regional de la Orinoquía",
        "https://www.corporinoquia.gov.co",
    ),
}

INTERNATIONAL_AUTHORITIES: dict[str, tuple[str, str, str | None]] = {
    "Argentina": (
        "SNMF / SINAGIR",
        (
            "Servicio Nacional de Manejo del Fuego y Sistema Nacional para la "
            "Gestión Integral del Riesgo"
        ),
        "https://www.argentina.gob.ar/ambiente/fuego",
    ),
    "Australia": (
        "AFAC / NEMA",
        (
            "Australasian Fire and Emergency Service Authorities Council & "
            "National Emergency Management Agency"
        ),
        "https://www.afac.com.au",
    ),
    "Austria": (
        "BML / BMI Civil Protection",
        "Federal Ministry of Agriculture, Forestry & Austrian Civil Protection",
        "https://www.bml.gv.at",
    ),
    "Bangladesh": (
        "BFD / DDM",
        "Bangladesh Forest Department & Department of Disaster Management",
        "https://bforest.gov.bd",
    ),
    "Bolivia": (
        "ABT / VIDECI",
        "Autoridad de Fiscalización y Control Social de Bosques y Tierra & Defensa Civil",
        "https://www.abt.gob.bo",
    ),
    "Botswana": (
        "DFRR / NDMO",
        "Department of Forestry and Range Resources & National Disaster Management",
        "https://www.gov.bw",
    ),
    "Brazil": (
        "IBAMA-PREVFOGO / INPE",
        "Centro Nacional de Prevenção e Combate aos Incêndios Florestais & INPE Queimadas",
        "https://terrabrasilis.dpi.inpe.br/queimadas/",
    ),
    "Bulgaria": (
        "EFA / DGFSCP",
        "Executive Forest Agency & Fire Safety and Civil Protection Directorate",
        "https://www.iag.bg",
    ),
    "Cambodia": (
        "FA / NCDM",
        "Forestry Administration & National Committee for Disaster Management",
        "https://www.ncdm.gov.kh",
    ),
    "Cameroon": (
        "MINFOF / DPC",
        "Ministry of Forestry and Wildlife & Directorate of Civil Protection",
        "https://www.minfof.cm",
    ),
    "Canada": (
        "CIFFC / CWFIS",
        "Canadian Interagency Forest Fire Centre & Canadian Wildland Fire Information System",
        "https://www.ciffc.ca",
    ),
    "Chile": (
        "CONAF / SENAPRED",
        (
            "Corporación Nacional Forestal y Servicio Nacional de Prevención y "
            "Respuesta ante Desastres"
        ),
        "https://www.conaf.cl",
    ),
    "China": (
        "MEM / NFGA",
        "Ministry of Emergency Management & National Forestry and Grassland Administration",
        "https://www.mem.gov.cn",
    ),
    "Costa Rica": (
        "SINAC / CNE",
        "Sistema Nacional de Áreas de Conservación y Comisión Nacional de Emergencias",
        "https://www.sinac.go.cr",
    ),
    "Croatia": (
        "HVZ / DUZS",
        "Croatian Firefighting Association & Civil Protection Directorate",
        "https://hvz.gov.hr",
    ),
    "Cuba": (
        "CGB / Defensa Civil",
        "Cuerpo de Guardabosques de Cuba y Estado Mayor Nacional de la Defensa Civil",
        "https://www.minag.gob.cu",
    ),
    "Democratic Republic of the Congo": (
        "MEDD / CNPC",
        "Ministère de l'Environnement et Développement Durable & Protection Civile",
        "https://www.medd.gouv.cd",
    ),
    "Dominican Republic": (
        "MIMARENA / COE",
        "Ministerio de Medio Ambiente y Recursos Naturales & Centro de Operaciones de Emergencias",
        "https://ambiente.gob.do",
    ),
    "Ecuador": (
        "MAATE / SGR",
        "Ministerio del Ambiente, Agua y Transición Ecológica & Secretaría de Gestión de Riesgos",
        "https://www.gestionderiesgos.gob.ec",
    ),
    "El Salvador": (
        "MARN / Protección Civil",
        "Ministerio de Medio Ambiente y Recursos Naturales & Dirección General de Protección Civil",
        "https://www.proteccioncivil.gob.sv",
    ),
    "Ethiopia": (
        "EFCCC / EDRMC",
        "Ethiopian Forestry Development & Disaster Risk Management Commission",
        "https://www.drmc.gov.et",
    ),
    "Finland": (
        "SPEK / Ministry of Interior",
        "Finnish National Rescue Association & Civil Protection Rescue Services",
        "https://pelastustoimi.fi",
    ),
    "France": (
        "DGSCGC / BDF-ONF",
        "Direction Générale de la Sécurité Civile & Office National des Forêts",
        "https://www.interieur.gouv.fr",
    ),
    "Germany": (
        "BBK / DWD Waldbrand",
        "Federal Office of Civil Protection and Disaster Assistance & DWD Fire Danger",
        "https://www.bbk.bund.de",
    ),
    "Ghana": (
        "FC / NADMO",
        "Forestry Commission of Ghana & National Disaster Management Organisation",
        "https://www.fcghana.org",
    ),
    "Greece": (
        "GSCP / Hellenic Fire Corps",
        "General Secretariat for Civil Protection & Hellenic Fire Service",
        "https://civilprotection.gov.gr",
    ),
    "Guatemala": (
        "CONAP / CONRED",
        "Consejo Nacional de Áreas Protegidas & "
        "Coordinadora Nacional para la Reducción de Desastres",
        "https://conred.gob.gt",
    ),
    "Honduras": (
        "ICF / COPECO",
        "Instituto de Conservación Forestal & Comisión Permanente de Contingencias",
        "https://icf.gob.hn",
    ),
    "India": (
        "FSI / NDMA",
        "Forest Survey of India (Van Agni) & National Disaster Management Authority",
        "https://fsi.nic.in",
    ),
    "Indonesia": (
        "KLHK SiPongi / BNPB",
        "Ministry of Environment and Forestry Fire Monitoring & "
        "National Disaster Mitigation Agency",
        "https://sipongi.menlhk.go.id",
    ),
    "Italy": (
        "DPC / Vigili del Fuoco",
        "Dipartimento della Protezione Civile & Corpo Nazionale dei Vigili del Fuoco",
        "https://www.protezionecivile.gov.it",
    ),
    "Japan": (
        "FDMA / Forestry Agency",
        "Fire and Disaster Management Agency & Ministry of Agriculture, Forestry and Fisheries",
        "https://www.fdma.go.jp",
    ),
    "Kenya": (
        "KFS / NDOC",
        "Kenya Forest Service & National Disaster Operations Centre",
        "https://www.kenyaforestservice.org",
    ),
    "Laos": (
        "DOF / NDMO",
        "Department of Forestry & National Disaster Management Office",
        "https://www.maf.gov.la",
    ),
    "Madagascar": (
        "MEDD / BNGRC",
        "Ministère de l'Environnement & Bureau National de Gestion des Risques et des Catastrophes",
        "https://www.bngrc-mid.mg",
    ),
    "Malaysia": (
        "JPSM / NADMA",
        "Forestry Department Peninsular Malaysia & National Disaster Management Agency",
        "https://www.nadma.gov.my",
    ),
    "Mexico": (
        "CONAFOR / CNPC",
        "Comisión Nacional Forestal & Coordinación Nacional de Protección Civil",
        "https://www.gob.mx/conafor",
    ),
    "Morocco": (
        "ANEF / Protection Civile",
        "Agence Nationale des Eaux et Forêts & Direction Générale de la Protection Civile",
        "https://www.eauxetforets.gov.ma",
    ),
    "Mozambique": (
        "DINAF / INGD",
        "Direcção Nacional de Florestas & Instituto Nacional de Gestão de Risco de Desastres",
        "https://www.ingd.gov.mz",
    ),
    "Myanmar": (
        "FD / DDM",
        "Forest Department & Department of Disaster Management",
        "https://www.forestdepartment.gov.mm",
    ),
    "Namibia": (
        "MEFT / DDRM",
        "Ministry of Environment, Forestry and Tourism & Disaster Risk Management",
        "https://www.meft.gov.na",
    ),
    "Nepal": (
        "MoFE / NDRRMA",
        "Ministry of Forests and Environment & National Disaster Risk Reduction Authority",
        "https://bipadportal.gov.np",
    ),
    "New Zealand": (
        "FENZ / NEMA",
        "Fire and Emergency New Zealand & National Emergency Management Agency",
        "https://www.fireandemergency.nz",
    ),
    "Nicaragua": (
        "INAFOR / SINAPRED",
        "Instituto Nacional Forestal & Sistema Nacional para la Prevención de Desastres",
        "https://www.sinapred.gob.ni",
    ),
    "Nigeria": (
        "FDF / NEMA",
        "Federal Department of Forestry & National Emergency Management Agency",
        "https://nema.gov.ng",
    ),
    "Norway": (
        "DSB",
        "Norwegian Directorate for Civil Protection",
        "https://www.dsb.no",
    ),
    "Panama": (
        "MiAMBIENTE / SINAPROC",
        "Ministerio de Ambiente & Sistema Nacional de Protección Civil",
        "https://www.sinaproc.gob.pa",
    ),
    "Paraguay": (
        "INFONA / SEN",
        "Instituto Forestal Nacional & Secretaría de Emergencia Nacional",
        "https://infona.gov.py",
    ),
    "Peru": (
        "SERFOR / INDECI / COEN",
        "Servicio Nacional Forestal y de Fauna Silvestre & Defensa Civil (INDECI)",
        "https://www.gob.pe/serfor",
    ),
    "Philippines": (
        "DENR-FMB / NDRRMC",
        "Forest Management Bureau & National Disaster Risk Reduction Council",
        "https://forestry.denr.gov.ph",
    ),
    "Poland": (
        "LP / PSP",
        "State Forests National Forest Holding & State Fire Service (PSP)",
        "https://www.lasy.gov.pl",
    ),
    "Portugal": (
        "ICNF / ANEPC",
        "Instituto da Conservação da Natureza e das Florestas & Proteção Civil",
        "https://www.icnf.pt",
    ),
    "Romania": (
        "IGSU / Romsilva",
        "General Inspectorate for Emergency Situations & National Forest Administration",
        "https://www.igsu.ro",
    ),
    "Russia": (
        "Avialesookhrana / EMERCOM",
        "Aerial Forest Fire Centre & Ministry of Emergency Situations",
        "https://aviales.ru",
    ),
    "South Africa": (
        "DFFE / NDMC",
        "Department of Forestry, Fisheries and the Environment & National Disaster Management",
        "https://www.dffe.gov.za",
    ),
    "South Korea": (
        "KFS",
        "Korea Forest Service — National Forest Fire Information Center",
        "https://www.forest.go.kr",
    ),
    "Spain": (
        "MITECO / CENEM",
        (
            "Subdirección General de Política Forestal y Lucha contra la "
            "Desertificación & Protección Civil"
        ),
        "https://www.miteco.gob.es",
    ),
    "Sweden": (
        "MSB",
        "Swedish Civil Contingencies Agency (Myndigheten för samhällsskydd)",
        "https://www.msb.se",
    ),
    "Tanzania": (
        "TFS / PMO-DMD",
        "Tanzania Forest Services Agency & Disaster Management Department",
        "https://www.tfs.go.tz",
    ),
    "Thailand": (
        "DNP / DDPM",
        "Department of National Parks & Department of Disaster Prevention and Mitigation",
        "https://www.dnp.go.th",
    ),
    "Turkey": (
        "OGM / AFAD",
        "General Directorate of Forestry (Orman Genel Müdürlüğü) & AFAD",
        "https://www.ogm.gov.tr",
    ),
    "Ukraine": (
        "SESU / SAFR",
        "State Emergency Service of Ukraine & State Forest Resources Agency",
        "https://dsns.gov.ua",
    ),
    "United Kingdom": (
        "NFCC / Defra",
        "National Fire Chiefs Council & UK Met Office Fire Severity Index",
        "https://nfcc.org.uk",
    ),
    "United States": (
        "NIFC / USFS",
        "National Interagency Fire Center & USDA Forest Service",
        "https://www.nifc.gov",
    ),
    "Uruguay": (
        "SINAE / DGF",
        "Sistema Nacional de Emergencias & Dirección General Forestal",
        "https://www.gub.uy/sistema-nacional-emergencias/",
    ),
    "Venezuela": (
        "INPARQUES / PCAD",
        "Instituto Nacional de Parques & Dirección Nacional de Protección Civil",
        "http://www.inparques.gob.ve",
    ),
    "Vietnam": (
        "VNFOREST / VNDMA",
        "Vietnam Administration of Forestry & Disaster Management Authority",
        "https://www.kiemlam.org.vn",
    ),
    "Zambia": (
        "FD / DMMU",
        "Forestry Department & Disaster Management and Mitigation Unit",
        "https://www.dmmu.gov.zm",
    ),
    "Zimbabwe": (
        "EMA / DCP",
        "Environmental Management Agency & Department of Civil Protection",
        "https://www.ema.co.zw",
    ),
}


def get_authorities_for_aoi(
    *,
    department: str | None = None,
    country: str | None = None,
    in_colombia: bool = True,
    region_name: str | None = None,
) -> list[AuthorityContact]:
    """Return institutional contacts ordered from regional to national authority."""
    contacts: list[AuthorityContact] = []
    if in_colombia or country == "Colombia":
        if department and department in COLOMBIA_CAR_BY_DEPARTMENT:
            car_code, car_name, car_portal = COLOMBIA_CAR_BY_DEPARTMENT[department]
            contacts.append(
                AuthorityContact(
                    code=car_code,
                    name=car_name,
                    level="regional_environmental",
                    role_es=(
                        f"Autoridad ambiental regional en {department}: control de quemas no "
                        "autorizadas, protección de áreas protegidas y verificación en campo."
                    ),
                    role_en=(
                        f"Regional environmental authority in {department}: burn permitting "
                        "enforcement, protected-area monitoring, and ground verification."
                    ),
                    portal=car_portal,
                )
            )
            contacts.append(
                AuthorityContact(
                    code=f"CDGRD {department}",
                    name=(
                        "Consejo Departamental para la Gestión del Riesgo de Desastres "
                        f"\u2014 Gobernación de {department}"
                    ),
                    level="departmental",
                    role_es=(
                        f"Activación de Puesto de Mando Unificado (PMU) en {department} y "
                        "notificación a Consejos Municipales (CMGRD)."
                    ),
                    role_en=(
                        f"Departmental Unified Command (PMU) activation in {department} and "
                        "alert cascade to municipal risk councils."
                    ),
                )
            )
        elif region_name and "orinoqu" in region_name.lower():
            contacts.append(
                AuthorityContact(
                    code="CORPORINOQUIA / CORMACARENA",
                    name=(
                        "Autoridades Ambientales de la Orinoquía "
                        "(CORPORINOQUIA y CORMACARENA)"
                    ),
                    level="regional_environmental",
                    role_es=(
                        "Monitoreo regional de quemas de sabana y bosques de galería en "
                        "Meta, Casanare, Arauca y Vichada."
                    ),
                    role_en=(
                        "Regional monitoring of savanna burns and gallery forests across "
                        "Meta, Casanare, Arauca, and Vichada."
                    ),
                    portal="https://www.corporinoquia.gov.co",
                )
            )
        contacts.extend(NATIONAL_COLOMBIA_AUTHORITIES)
        return contacts

    target_country = country or "Global"
    if target_country in INTERNATIONAL_AUTHORITIES:
        code, name, portal = INTERNATIONAL_AUTHORITIES[target_country]
        contacts.append(
            AuthorityContact(
                code=code,
                name=name,
                level="international",
                role_es=(
                    "Autoridad nacional competente de manejo del fuego y protección civil "
                    f"en {region_name or target_country}."
                ),
                role_en=(
                    "Competent national wildfire management and civil protection agency "
                    f"for {region_name or target_country}."
                ),
                portal=portal,
            )
        )
    else:
        area_label = region_name or target_country
        contacts.append(
            AuthorityContact(
                code="CIVIL-PROT",
                name=f"National Civil Protection & Forestry Fire Agency ({area_label})",
                level="international",
                role_es=(
                    "Entidad nacional/subnacional de gestión del riesgo y monitoreo forestal "
                    "competente en el polígono seleccionado."
                ),
                role_en=(
                    "National/subnational civil protection and forestry monitoring agency "
                    "with jurisdiction over the selected area."
                ),
                portal="https://gwis.jrc.ec.europa.eu",
            )
        )
    return contacts
