import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { CreateCommentDto } from './dto/create-comment.dto';

@Injectable()
export class PostsService {
  constructor(private prisma: PrismaService) {}

  private generateSlug(title: string): string {
    return title
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  async findPublished() {
    return this.prisma.post.findMany({
      where: { isPublished: true },
      orderBy: { publishedAt: 'desc' },
      include: {
        _count: {
          select: { comments: true },
        },
      },
    });
  }

  async findAllAdmin() {
    return this.prisma.post.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { comments: true },
        },
      },
    });
  }

  async findBySlug(slug: string) {
    const post = await this.prisma.post.findUnique({
      where: { slug },
      include: {
        comments: {
          where: { parentId: null },
          orderBy: { createdAt: 'desc' },
          include: {
            replies: {
              orderBy: { createdAt: 'asc' },
            },
          },
        },
      },
    });
    if (!post) {
      throw new NotFoundException(`Post with slug ${slug} not found`);
    }
    return post;
  }

  async create(dto: CreatePostDto) {
    const slug = this.generateSlug(dto.title);
    
    const existing = await this.prisma.post.findUnique({ where: { slug } });
    if (existing) {
      throw new ConflictException(`A post with title similar to "${dto.title}" already exists`);
    }

    return this.prisma.post.create({
      data: {
        ...dto,
        slug,
        publishedAt: dto.isPublished ? new Date() : null,
      },
    });
  }

  async update(id: string, dto: UpdatePostDto) {
    const post = await this.prisma.post.findUnique({ where: { id } });
    if (!post) {
      throw new NotFoundException(`Post with ID ${id} not found`);
    }

    let slug = post.slug;
    if (dto.title && dto.title !== post.title) {
      slug = this.generateSlug(dto.title);
      const existing = await this.prisma.post.findUnique({ where: { slug } });
      if (existing && existing.id !== id) {
        throw new ConflictException(`A post with title similar to "${dto.title}" already exists`);
      }
    }

    let publishedAt = post.publishedAt;
    if (dto.isPublished && !post.isPublished) {
      publishedAt = new Date();
    } else if (dto.isPublished === false) {
      publishedAt = null;
    }

    return this.prisma.post.update({
      where: { id },
      data: {
        ...dto,
        slug,
        publishedAt,
      },
    });
  }

  async remove(id: string) {
    const post = await this.prisma.post.findUnique({ where: { id } });
    if (!post) {
      throw new NotFoundException(`Post with ID ${id} not found`);
    }
    return this.prisma.post.delete({
      where: { id },
    });
  }

  async toggleLike(id: string, action: 'like' | 'unlike' = 'like') {
    const post = await this.prisma.post.findUnique({ where: { id } });
    if (!post) {
      throw new NotFoundException(`Post with ID ${id} not found`);
    }

    const currentLikes = post.likesCount || 0;
    const newLikes = action === 'unlike' ? Math.max(0, currentLikes - 1) : currentLikes + 1;

    return this.prisma.post.update({
      where: { id },
      data: { likesCount: newLikes },
      select: { id: true, likesCount: true },
    });
  }

  async addComment(postId: string, dto: CreateCommentDto) {
    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (!post) {
      throw new NotFoundException(`Post with ID ${postId} not found`);
    }

    if (dto.parentId) {
      const parentComment = await this.prisma.comment.findUnique({
        where: { id: dto.parentId },
      });
      if (!parentComment || parentComment.postId !== postId) {
        throw new NotFoundException('Parent comment not found for this post');
      }
    }

    return this.prisma.comment.create({
      data: {
        postId,
        author: dto.author.trim(),
        content: dto.content.trim(),
        parentId: dto.parentId || null,
      },
    });
  }
}
