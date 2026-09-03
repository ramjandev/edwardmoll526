import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsNumber, IsOptional, IsString, IsArray } from 'class-validator';

export class CreateQuoteDto {
  @ApiProperty({ example: 'Edward', description: 'Customer first name' })
  @IsString()
  @IsNotEmpty()
  firstName!: string;

  @ApiProperty({ example: 'Moll', description: 'Customer last name' })
  @IsString()
  @IsNotEmpty()
  lastName!: string;

  @ApiProperty({ example: 'edward@example.com', description: 'Customer email' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: '(602) 555-0199', description: 'Customer phone number' })
  @IsString()
  @IsNotEmpty()
  phone!: string;

  @ApiProperty({ example: '123 Phoenix Way', required: false })
  @IsString()
  @IsOptional()
  addressLine1?: string;

  @ApiProperty({ example: 'Suite 4', required: false })
  @IsString()
  @IsOptional()
  addressLine2?: string;

  @ApiProperty({ example: 'Phoenix', required: false })
  @IsString()
  @IsOptional()
  city?: string;

  @ApiProperty({ example: 'AZ', required: false })
  @IsString()
  @IsOptional()
  state?: string;

  @ApiProperty({ example: '85001', required: false })
  @IsString()
  @IsOptional()
  zip?: string;

  @ApiProperty({ example: 'Apartment', description: 'Residence type from Quote Calculator B4' })
  @IsString()
  @IsNotEmpty()
  houseSize!: string;

  @ApiProperty({ example: 2, required: false, description: 'Bedrooms (1-4) for Quote Calculator B5' })
  @IsNumber()
  @IsOptional()
  bedrooms?: number;

  @ApiProperty({ example: 2, description: 'Number of flights of stairs (fallback if access fields are omitted)' })
  @IsNumber()
  stairs!: number;

  @ApiProperty({ example: 'No stairs', required: false, description: 'Origin access for Quote Calculator B6' })
  @IsString()
  @IsOptional()
  originAccess?: string;

  @ApiProperty({ example: 'No stairs', required: false, description: 'Destination access for Quote Calculator B7' })
  @IsString()
  @IsOptional()
  destinationAccess?: string;

  @ApiProperty({ example: 'None', required: false, description: 'Elevator wait / long carry for Quote Calculator B8' })
  @IsString()
  @IsOptional()
  elevatorWait?: string;

  @ApiProperty({ example: ['Upright piano'], type: [String], description: 'Specialty item types matching the sheet dropdowns' })
  @IsArray()
  @IsString({ each: true })
  heavyItems!: string[];

  @ApiProperty({ example: 15, description: 'Move distance in miles (Quote Calculator B10)' })
  @IsNumber()
  distance!: number;

  @ApiProperty({
    example: 'None',
    required: false,
    description: 'Packing help: None, Partial, or Full (Quote Calculator B9).',
  })
  @IsString()
  @IsOptional()
  packingHelp?: string;
}
