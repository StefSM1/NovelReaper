import type { RuleSetRule } from 'webpack';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';

const isProduction = process.env.NODE_ENV !== 'development';

export const rules: RuleSetRule[] = [
  {
    test: /\.tsx?$/,
    exclude: /node_modules/,
    use: {
      loader: 'ts-loader',
      options: {
        transpileOnly: true,
      },
    },
  },
  {
    test: /\.css$/,
    use: [isProduction ? MiniCssExtractPlugin.loader : 'style-loader', 'css-loader'],
  },
  {
    test: /\.(woff2?|png|jpe?g|gif|svg)$/i,
    type: 'asset/resource',
    generator: {
      filename: 'assets/[name].[contenthash][ext]',
    },
  },
];
