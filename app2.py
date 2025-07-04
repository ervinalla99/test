import ifcopenshell
import pandas as pd
from collections import defaultdict

# === INPUT FILES ===
excel_file = "modelliDatiErvinSL.xlsx"
ifc_file_path = "RR1I_01_E_NT_3M_SL05_ST_001.ifc"  # Update path if needed

# === STEP 1: Read Excel and Build Requirement Mapping ===
df = pd.read_excel(excel_file)

required_data = defaultdict(list)
for _, row in df.iterrows():
    elemento = str(row['Elemento']).strip()
    parameter = str(row['Parametri informativi']).strip()
    pset = str(row['Pset_personalizzato']).strip()
    required_data[elemento].append({'parameter': parameter, 'pset': pset})


# === STEP 2: Helper Functions ===

def extract_psets(element):
    """Extract all Psets and their properties from an IFC element."""
    psets = defaultdict(dict)
    if hasattr(element, 'IsDefinedBy'):
        for rel in element.IsDefinedBy:
            if rel.is_a('IfcRelDefinesByProperties'):
                prop_set = rel.RelatingPropertyDefinition
                if prop_set.is_a('IfcPropertySet'):
                    pset_name = prop_set.Name
                    for prop in prop_set.HasProperties:
                        if hasattr(prop, 'Name') and hasattr(prop, 'NominalValue') and prop.NominalValue:
                            value = getattr(prop.NominalValue, 'wrappedValue', str(prop.NominalValue))
                            psets[pset_name][prop.Name] = value
    return psets

def get_nome_oggetto(element):
    """Find the value of the NomeOggetto parameter for an IFC element."""
    if hasattr(element, 'IsDefinedBy'):
        for rel in element.IsDefinedBy:
            if rel.is_a('IfcRelDefinesByProperties'):
                prop_set = rel.RelatingPropertyDefinition
                if prop_set.is_a('IfcPropertySet'):
                    for prop in prop_set.HasProperties:
                        if prop.Name == 'NomeOggetto' and prop.NominalValue:
                            return getattr(prop.NominalValue, 'wrappedValue', str(prop.NominalValue))
    return None

def get_element_guid(element):
    """Extract the GUID from the element's properties."""
    if hasattr(element, 'IsDefinedBy'):
        for rel in element.IsDefinedBy:
            if rel.is_a('IfcRelDefinesByProperties'):
                prop_set = rel.RelatingPropertyDefinition
                if prop_set.is_a('IfcPropertySet'):
                    for prop in prop_set.HasProperties:
                        if prop.Name == 'GUID' and prop.NominalValue:
                            return getattr(prop.NominalValue, 'wrappedValue', str(prop.NominalValue))
    return None


# === STEP 3: Load IFC File ===
print(f"Opening IFC file: {ifc_file_path}")
ifc_file = ifcopenshell.open(ifc_file_path)
elements = ifc_file.by_type("IfcElement")

print(f"Total elements found: {len(elements)}")


# === STEP 4: Validate Each Element ===

missing_report = []

for element in elements:
    nome_oggetto = get_nome_oggetto(element)
    if not nome_oggetto:
        continue
    nome_oggetto = str(nome_oggetto).strip()

    if nome_oggetto not in required_data:
        continue  # No requirements to check for this object

    expected_props = required_data[nome_oggetto]
    actual_psets = extract_psets(element)

    for req in expected_props:
        expected_pset = req['pset']
        expected_param = req['parameter']
        if expected_pset not in actual_psets or expected_param not in actual_psets[expected_pset]:
            missing_report.append({
                'GUID': get_element_guid(element),
                'NomeOggetto': nome_oggetto,
                'Missing Parameter': expected_param,
                'Expected Pset': expected_pset
            })

# === STEP 4b: Check Project-Level Pset ===
project_level_issues = []
project_entities = ifc_file.by_type("IfcProject")

for project in project_entities:
    psets = extract_psets(project)
    pset_name = "Informazioni progetto"
    expected_keys = [
        "NomeModello", "Revisione", "DataRevisione", "LivelloDiProgettazione"
    ]
    for key in expected_keys:
        if pset_name not in psets or key not in psets[pset_name]:
            project_level_issues.append({'Missing Parameter': key, 'Pset': pset_name})

# === STEP 4c: Additional element-level checks for fixed Psets ===
fixed_element_checks = [
    # (parameter name, pset name)
    ("NomeOpera", "Identità"),
    ("ParteOpera", "Identità"),
    ("NomeOggetto", "Identità"),
    ("GUID", "Identità"),
    ("Disciplina", "Identità"),
    ("Tipologia", "Identità"),
    ("WBS7OperaPrincipale", "Identità"),
    ("WBS8TrattoOpera", "Identità"),
    ("WBS9ParteOpera", "Identità"),
    ("CodiceIdentità", "Identità"),
    ("FaseProgetto", "Identità"),
    ("PrezzarioDiRiferimento", "Informazioni costi"),
    ("IDCronoprogramma", "Informazioni tempi")
]

for element in elements:
    nome_oggetto = get_nome_oggetto(element)
    if not nome_oggetto:
        continue
    nome_oggetto = str(nome_oggetto).strip()

    actual_psets = extract_psets(element)

    for param_name, pset_name in fixed_element_checks:
        if pset_name not in actual_psets or param_name not in actual_psets[pset_name]:
            missing_report.append({
                'GUID': get_element_guid(element),
                'NomeOggetto': nome_oggetto,
                'Missing Parameter': param_name,
                'Expected Pset': pset_name
            })
# === STEP 4d: Reverse check for unexpected parameters or Psets ===
unexpected_report = []

# Build a lookup for fixed checks by pset
fixed_lookup = defaultdict(set)
for param, pset in fixed_element_checks:
    fixed_lookup[pset].add(param)

for element in elements:
    nome_oggetto = get_nome_oggetto(element)
    if not nome_oggetto:
        continue
    nome_oggetto = str(nome_oggetto).strip()

    if nome_oggetto not in required_data:
        continue

    expected_from_excel = required_data[nome_oggetto]
    expected_lookup = defaultdict(set)
    for item in expected_from_excel:
        expected_lookup[item['pset']].add(item['parameter'])

    actual_psets = extract_psets(element)

    for pset_name, props in actual_psets.items():
        for prop_name in props:
            allowed = (
                prop_name in expected_lookup.get(pset_name, set()) or
                prop_name in fixed_lookup.get(pset_name, set())
            )
            if not allowed:
                unexpected_report.append({
                    'GUID': get_element_guid(element),
                    'NomeOggetto': nome_oggetto,
                    'Unexpected Parameter': prop_name,
                    'Pset': pset_name
                })
# === STEP 4e: Check for unexpected Psets themselves ===
allowed_psets = set()

# From Excel
for props in required_data.values():
    for item in props:
        allowed_psets.add(item['pset'])

# From fixed checks
for _, pset in fixed_element_checks:
    allowed_psets.add(pset)

unexpected_pset_report = []

for element in elements:
    nome_oggetto = get_nome_oggetto(element)
    if not nome_oggetto:
        continue
    nome_oggetto = str(nome_oggetto).strip()

    actual_psets = extract_psets(element)
    for pset_name in actual_psets:
        if pset_name not in allowed_psets:
            unexpected_pset_report.append({
                'GUID': get_element_guid(element),
                'NomeOggetto': nome_oggetto,
                'Unexpected Pset': pset_name
            })

# === STEP 5: Report Results ===
print("\n=== VALIDATION REPORT ===")

# 1. Project-Level Pset Issues
print("\n--- PROJECT-LEVEL CHECK ---")
if not project_level_issues:
    print("✅ All required project-level parameters are present.")
else:
    print(f"❌ Missing {len(project_level_issues)} project-level parameters:")
    for issue in project_level_issues:
        print(f"- Missing '{issue['Missing Parameter']}' in Pset '{issue['Pset']}'")

# 2. Element-Level Issues (Excel + fixed checks)
print("\n--- ELEMENT-LEVEL CHECKS ---")
if not missing_report:
    print("✅ All required element-level parameters are present.")
else:
    print(f"❌ {len(missing_report)} element-level issues found:")
    for issue in missing_report:
        print(f"- GUID {issue['GUID']} | NomeOggetto: {issue['NomeOggetto']}")
        print(f"  Missing: {issue['Missing Parameter']} in Pset '{issue['Expected Pset']}'\n")
# 3. Unexpected Parameters
print("\n--- UNEXPECTED PARAMETERS CHECK ---")
if not unexpected_report:
    print("✅ No unexpected parameters found in elements.")
else:
    print(f"❌ {len(unexpected_report)} unexpected parameters found in elements:")
    for issue in unexpected_report:
        print(f"- GUID {issue['GUID']} | NomeOggetto: {issue['NomeOggetto']}")
        print(f"  Unexpected: {issue['Unexpected Parameter']} in Pset '{issue['Pset']}'\n")
# 4. Unexpected Psets
print("\n--- UNEXPECTED PSETS CHECK ---")
if not unexpected_pset_report:
    print("✅ No unexpected Psets found in elements.")
else:
    print(f"❌ {len(unexpected_pset_report)} unexpected Psets found in elements:")
    for issue in unexpected_pset_report:
        print(f"- GUID {issue['GUID']} | NomeOggetto: {issue['NomeOggetto']}")
        print(f"  Unexpected Pset: '{issue['Unexpected Pset']}'\n")

# === STEP 6: Save Report to Excel ===
report_filename = "validation_report_SL.xlsx"
with pd.ExcelWriter(report_filename) as writer:
    # Add IFC file name as a separate sheet
    pd.DataFrame({"IFC File": [ifc_file_path]}).to_excel(writer, sheet_name="IFC Info", index=False)
    if missing_report:
        pd.DataFrame(missing_report).to_excel(writer, sheet_name="Element-Level Issues", index=False)
    if project_level_issues:
        pd.DataFrame(project_level_issues).to_excel(writer, sheet_name="Project-Level Issues", index=False)
    if unexpected_report:
        pd.DataFrame(unexpected_report).to_excel(writer, sheet_name="Unexpected Parameters", index=False)
    if unexpected_pset_report:
        pd.DataFrame(unexpected_pset_report).to_excel(writer, sheet_name="Unexpected Psets", index=False)

print(f"\nReport saved to {report_filename}")
