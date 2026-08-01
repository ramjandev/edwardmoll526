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

  @ApiProperty({ example: '2 Bedroom Apartment', description: 'Moving size / type' })
  @IsString()
  @IsNotEmpty()
  houseSize!: string;

  @ApiProperty({ example: 2, description: 'Number of flights of stairs' })
  @IsNumber()
  stairs!: number;

  @ApiProperty({ example: ['Piano', 'Pool Table'], type: [String], description: 'List of heavy items' })
  @IsArray()
  @IsString({ each: true })
  heavyItems!: string[];

  @ApiProperty({ example: 15, description: 'Estimated distance of the move in miles' })
  @IsNumber()
  distance!: number;
}
