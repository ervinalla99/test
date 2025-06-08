import ifcopenshell

# Load the IFC file
ifc_file_path = 'RR1H_01_C_NT_3M_GA02_ST_001.ifc'  # Your IFC file path
ifc_file = ifcopenshell.open(ifc_file_path)

# Function to extract Psets and their properties for each element
def extract_psets(element):
    element_psets_data = []  # Renamed for clarity
    if hasattr(element, 'IsDefinedBy'):
        for definition_relationship in element.IsDefinedBy:  # This is IfcRelDefines (e.g., IfcRelDefinesByProperties)
            if definition_relationship.is_a('IfcRelDefinesByProperties'):
                property_set_definition = definition_relationship.RelatingPropertyDefinition
                if property_set_definition and property_set_definition.is_a('IfcPropertySet'):
                    actual_pset = property_set_definition  # This is the IfcPropertySet
                    pset_data = {
                        'Pset Name': actual_pset.Name,
                        'Properties': []
                    }
                    if hasattr(actual_pset, 'HasProperties'):
                        for prop in actual_pset.HasProperties:
                            if hasattr(prop, 'Name') and hasattr(prop, 'NominalValue') and prop.NominalValue is not None:
                                value = None
                                if hasattr(prop.NominalValue, 'wrappedValue'):
                                    value = prop.NominalValue.wrappedValue
                                elif isinstance(prop.NominalValue, (str, int, float, bool)): # Direct value
                                    value = prop.NominalValue
                                else:
                                    value = str(prop.NominalValue)  # Fallback

                                prop_data_item = {  # Renamed
                                    'Property Name': prop.Name,
                                    'Property Value': value
                                }
                                pset_data['Properties'].append(prop_data_item)
                    element_psets_data.append(pset_data)
    return element_psets_data

# Function to print Psets for elements
def print_psets_for_elements():  # Remove nome_oggetto_filter parameter
    # Iterate over all elements in the IFC file
    elements_in_ifc = ifc_file.by_type('IfcElement')  # Adjust this based on your element types (e.g., IfcWall, IfcSlab)
    
    for element in elements_in_ifc:
        # Initialize the nome_oggetto variable
        nome_oggetto = None
        
        # Retrieve all parameters for the element and check for NomeOggetto
        if hasattr(element, 'IsDefinedBy'):
            for definition_relationship in element.IsDefinedBy:  # This is IfcRelDefines
                if definition_relationship.is_a('IfcRelDefinesByProperties'):
                    property_set_definition = definition_relationship.RelatingPropertyDefinition
                    if property_set_definition and property_set_definition.is_a('IfcPropertySet'):
                        actual_pset = property_set_definition
                        if hasattr(actual_pset, 'HasProperties'):
                            for prop in actual_pset.HasProperties:
                                # Check if we find the NomeOggetto parameter
                                if prop.Name == 'NomeOggetto':
                                    if prop.NominalValue:  # Ensure NominalValue exists
                                        if hasattr(prop.NominalValue, 'wrappedValue'):
                                            nome_oggetto = prop.NominalValue.wrappedValue
                                        elif isinstance(prop.NominalValue, (str, int, float, bool)):
                                            nome_oggetto = prop.NominalValue
                                        else:
                                            nome_oggetto = str(prop.NominalValue)  # Fallback
                                    break  # Found NomeOggetto in this PSet, no need to check other properties
                        if nome_oggetto is not None: # If found in current Pset collection, no need to check other definition relationships
                            break

        # Print element information
        print(f"Element ID: {element.id()}, NomeOggetto: {nome_oggetto if nome_oggetto else 'Not found'}")
            
        # Extract and print Psets for the element
        element_psets = extract_psets(element)
            
        if element_psets:
            for pset in element_psets:
                print(f"  Pset: {pset['Pset Name']}")
                for prop in pset['Properties']:
                    print(f"    Property Name: {prop['Property Name']}, Value: {prop['Property Value']}")
        else:
            print("  No Psets found for this element.")
        print("\n" + "-"*50 + "\n")

# Call the function to print the Psets for all elements
print_psets_for_elements()
