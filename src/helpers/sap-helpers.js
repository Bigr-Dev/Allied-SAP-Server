export function parseDDMMYYYYtoISO(input) {
  if (!input || typeof input !== 'string' || input.length !== 8) return null
  const day = input.slice(0, 2)
  const month = input.slice(2, 4)
  const year = input.slice(4, 8)
  return `${year}-${month}-${day}`
}

export function mapOrderFields(data) {
  return {
    sales_order_number: data.SalesOrderNumber, // <- RESTORED
    sales_person_name: data.SalesPersonName,
    doc_status: data.DocStatus,
    customer_name: data.CustomerName,
    document_due_date: parseDDMMYYYYtoISO(data.DocumentDueDate),
    address2: data.Address2,
    customer_reference_number: data.CustomerReferenceNumber,
    send_to_dispatch: data.SendToDispatch,
    logistics_verification: data.LogisticsVerification,
    quality_verification: data.QualityVerification,
    order_status: data.OrderStatus,
    def_address_on_customer_record: data.DefAddressOnCustomerRecord,
    street_on_customer_record: data.StreetOnCustomerRecord,
    block_on_customer_record: data.BlockOnCustomerRecord,
    city_on_customer_record: data.CityOnCustomerRecord,
    zip_code_on_customer_record: data.ZipCodeOnCustomerRecord,
    card_code: data.CardCode,
    sales_order_street_number: data.SalesOrderStreetNumber,
    sales_order_building: data.SalesOrderBuilding,
    sales_order_address_name: data.SalesOrderAddressName,
    sales_order_street: data.SalesOrderStreet,
    sales_order_block: data.SalesOrderBlock,
    sales_order_city: data.SalesOrderCity,
    sales_order_zip_code: data.SalesOrderZipCode,
    sales_order_route: data.SalesOrderRoute,
    sales_order_zone: data.SalesOrderZone,
    customer_opening_time_monday_to_friday:
      data.CustomerOpeningTimeMondayToFriday,
    customer_closing_time_monday_to_thursday:
      data.CustomerClosingTimeMondayToThursday,
    customer_closing_time_friday: data.CustomerClosingTimeFriday,
    customer_bp_code: data.CustomerBpCode,
    notes: data.Notes,
    dispatch_remarks: data.DispatchRemarks,
  }
}

// export function mapOrderFields(data) {
//   return {
//     sales_person_name: data.SalesPersonName,
//     // sales_order_number: data.SalesOrderNumber,
//     doc_status: data.DocStatus,
//     customer_name: data.CustomerName,
//     document_due_date: parseDDMMYYYYtoISO(data.DocumentDueDate),
//     address2: data.Address2,
//     customer_reference_number: data.CustomerReferenceNumber,
//     send_to_dispatch: data.SendToDispatch,
//     logistics_verification: data.LogisticsVerification,
//     quality_verification: data.QualityVerification,
//     order_status: data.OrderStatus,
//     def_address_on_customer_record: data.DefAddressOnCustomerRecord,
//     street_on_customer_record: data.StreetOnCustomerRecord,
//     block_on_customer_record: data.BlockOnCustomerRecord,
//     city_on_customer_record: data.CityOnCustomerRecord,
//     zip_code_on_customer_record: data.ZipCodeOnCustomerRecord,
//     card_code: data.CardCode,
//     sales_order_street_number: data.SalesOrderStreetNumber, // optional, if available
//     sales_order_building: data.SalesOrderBuilding, // optional, if available
//     sales_order_address_name: data.SalesOrderAddressName,
//     sales_order_street: data.SalesOrderStreet,
//     sales_order_block: data.SalesOrderBlock,
//     sales_order_city: data.SalesOrderCity,
//     sales_order_zip_code: data.SalesOrderZipCode,
//     sales_order_route: data.SalesOrderRoute,
//     sales_order_zone: data.SalesOrderZone,
//     customer_opening_time_monday_to_friday:
//       data.CustomerOpeningTimeMondayToFriday,
//     customer_closing_time_monday_to_thursday:
//       data.CustomerClosingTimeMondayToThursday,
//     customer_closing_time_friday: data.CustomerClosingTimeFriday,
//     customer_bp_code: data.CustomerBpCode,
//     notes: data.Notes,
//     dispatch_remarks: data.DispatchRemarks,
//   }
// }
