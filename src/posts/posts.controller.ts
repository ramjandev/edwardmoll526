import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PostsService } from './posts.service';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { LikePostDto } from './dto/like-post.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@ApiTags('Posts')
@Controller('posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all published posts' })
  findPublished() {
    return this.postsService.findPublished();
  }

  @Get('admin/all')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all posts including drafts (Admin only)' })
  findAllAdmin() {
    return this.postsService.findAllAdmin();
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Get a single post by slug' })
  findOne(@Param('slug') slug: string) {
    return this.postsService.findBySlug(slug);
  }

  @Post(':id/like')
  @ApiOperation({ summary: 'Like or unlike a post (Public)' })
  like(@Param('id') id: string, @Body() dto: LikePostDto) {
    return this.postsService.toggleLike(id, dto.action);
  }

  @Post(':id/comments')
  @ApiOperation({ summary: 'Submit a comment or reply on a post (Public)' })
  addComment(@Param('id') id: string, @Body() dto: CreateCommentDto) {
    return this.postsService.addComment(id, dto);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new post (Admin only)' })
  create(@Body() dto: CreatePostDto) {
    return this.postsService.create(dto);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a post (Admin only)' })
  update(@Param('id') id: string, @Body() dto: UpdatePostDto) {
    return this.postsService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a post (Admin only)' })
  remove(@Param('id') id: string) {
    return this.postsService.remove(id);
  }
}
